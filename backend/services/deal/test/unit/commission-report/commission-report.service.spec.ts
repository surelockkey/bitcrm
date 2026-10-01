import { BadRequestException } from '@nestjs/common';
import type { CommissionConfig, WorkizCommissionSnapshot } from '@bitcrm/types';
import { CommissionReportService } from 'src/commission-report/commission-report.service';
import type { CommissionDealItem } from 'src/commission-report/commission-report.types';
import {
  createMockCustomField,
  createMockCustomFieldsRepository,
  createMockExternalCompaniesRepository,
  createMockJobSourcesRepository,
  createMockJobTypesRepository,
  createMockJwtUser,
} from '../mocks';

const snapshot = (o: Partial<WorkizCommissionSnapshot>): WorkizCommissionSnapshot => ({
  source: 'workiz_commissions_report',
  capturedAt: '2026-09-29T19:42:46+00:00',
  techId: 'ann',
  rate: 50,
  rateUnit: '%',
  rateSource: 'tech',
  total: 100,
  tax: 0,
  tip: 0,
  parts: 0,
  companyParts: 0,
  techProfit: 50,
  companyProfit: 50,
  externalCompanyProfit: 0,
  paid: { cash: 100, credit: 0, check: 0 },
  billing: 0,
  cashByExternal: 0,
  closedLocal: '2026-09-02T19:00',
  ...o,
});

const deal = (id: string, o: Partial<CommissionDealItem> = {}): CommissionDealItem => ({
  id,
  dealNumber: id.toUpperCase(),
  contactId: `contact-${id}`,
  assignedTechIds: ['ann'],
  createdAt: '2026-08-20T15:00:00.000Z',
  scheduledDate: '2026-09-02',
  scheduledEndDate: '2026-09-02',
  scheduledTimeSlot: '18:00-19:00',
  jobTypeId: 'jt-1',
  superStatus: 'done',
  status: 'active',
  ...o,
});

const IMPORTED_ANN = deal('a1', { commissionSnapshot: snapshot({}) });
const IMPORTED_BOB = deal('b1', {
  assignedTechIds: ['bob', 'ann'],
  commissionSnapshot: snapshot({ techId: 'bob', total: 200, techProfit: 60, companyProfit: 140, paid: { cash: 0, credit: 200, check: 0 } }),
});
/** Window from Aug 30 to Sep 1: Closed on Sep 1, Scheduled on Aug 30. */
const MULTI_DAY = deal('m1', { scheduledDate: '2026-08-30', scheduledEndDate: '2026-09-01', commissionSnapshot: snapshot({ total: 10, techProfit: 5, companyProfit: 5, paid: { cash: 10, credit: 0, check: 0 } }) });
/** Closed before the period — read by the lookback, dropped by the end-day filter. */
const AUGUST = deal('aug', { scheduledDate: '2026-08-15', scheduledEndDate: '2026-08-15', commissionSnapshot: snapshot({}) });
/** Done in BitCRM: no snapshot. */
const NATIVE = deal('n1', {
  assignedTechIds: ['cat'],
  totals: { subtotal: 400, discount: 0, tax: 0, total: 400, cost: 0 },
  customFields: { 'cf-parts': 20 },
});

const config = (o: Partial<CommissionConfig> = {}): CommissionConfig => ({
  userId: 'cat',
  baseRatePct: 40,
  creditCardFeePct: 5,
  achFeePct: 0,
  effectiveDate: '2026-01-01T00:00:00.000Z',
  createdBy: 'u',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

function build(items: CommissionDealItem[] = [IMPORTED_ANN, IMPORTED_BOB, MULTI_DAY, AUGUST, NATIVE]) {
  const repository = {
    findDoneByVisitStart: jest.fn().mockResolvedValue({ items, truncated: false }),
    findDoneByCreated: jest.fn().mockResolvedValue({ items, truncated: false }),
    findDoneByTech: jest.fn().mockResolvedValue({ items, truncated: false }),
  };
  const client = {
    ledgers: jest.fn().mockResolvedValue(
      new Map([['n1', [{ method: 'card', status: 'settled', amount: 400, refundedAmount: 0 }]]]),
    ),
    commissionHistories: jest.fn().mockResolvedValue(new Map([['cat', [config()]]])),
    userNames: jest.fn().mockResolvedValue(new Map([['ann', 'Ann Lee'], ['bob', 'Bob Ray'], ['cat', 'Cat Moe']])),
    contactNames: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `Client ${id}`]))),
  };
  const jobTypes = createMockJobTypesRepository();
  jobTypes.listAll.mockResolvedValue([{ id: 'jt-1', name: 'Lockout' }]);
  const sources = createMockJobSourcesRepository();
  const companies = createMockExternalCompaniesRepository();
  const fields = createMockCustomFieldsRepository();
  fields.listAll.mockResolvedValue([createMockCustomField({ id: 'cf-parts', name: 'Tech Parts cost' } as never)]);
  const service = new CommissionReportService(
    repository as never,
    client as never,
    jobTypes as never,
    sources as never,
    companies as never,
    fields as never,
  );
  return { service, repository, client };
}

const office = createMockJwtUser({ id: 'office-1' });
const sept = { from: '2026-09-01', to: '2026-09-27' };

describe('CommissionReportService.parse', () => {
  const { service } = build();

  it('needs a real period, in order, of at most 186 days', () => {
    expect(() => service.parse({}, office, 'all')).toThrow(BadRequestException);
    expect(() => service.parse({ from: '2026-09-10', to: '2026-09-01' }, office, 'all')).toThrow(/before/);
    expect(() => service.parse({ from: '2026-01-01', to: '2026-12-31' }, office, 'all')).toThrow(/186/);
    expect(() => service.parse({ from: '2026-02-31' }, office, 'all')).not.toThrow();
  });

  it('defaults: Closed, Standard, one day, 50 rows', () => {
    expect(service.parse({ from: '2026-09-01' }, office, 'all')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-01',
      by: 'closed',
      mode: 'standard',
      offset: 0,
      limit: 50,
    });
  });

  it('the Tech report needs a technician', () => {
    expect(() => service.parse({ ...sept, mode: 'tech' }, office, 'all')).toThrow(/technician/);
  });

  it('assigned_only is narrowed to the caller, whatever technician is asked for', () => {
    const tech = createMockJwtUser({ id: 'ann' });
    expect(service.parse({ ...sept, techId: 'bob', mode: 'tech' }, tech, 'assigned_only').techId).toBe('ann');
  });

  it('clamps the page', () => {
    expect(service.parse({ ...sept, limit: '5000', offset: '-3' }, office, 'all')).toMatchObject({ limit: 500, offset: 0 });
  });
});

describe('CommissionReportService.report', () => {
  it('Closed reads visit starts from 31 days back and keeps the jobs whose window ENDS in the period', async () => {
    const { service, repository } = build();
    const r = await service.report(sept, office, 'all');
    expect(repository.findDoneByVisitStart).toHaveBeenCalledWith('2026-08-01', '2026-09-27');
    expect(r.rows.map((x) => x.dealNumber).sort()).toEqual(['A1', 'B1', 'M1', 'N1']);
    expect(r.count).toBe(4);
    expect(r.window).toEqual({ by: 'closed', ...sept });
  });

  it('Scheduled reads the period itself and keys on the visit start', async () => {
    const { service, repository } = build();
    const r = await service.report({ ...sept, by: 'scheduled' }, office, 'all');
    expect(repository.findDoneByVisitStart).toHaveBeenCalledWith('2026-09-01', '2026-09-27');
    expect(r.rows.map((x) => x.dealNumber).sort()).toEqual(['A1', 'B1', 'N1']);
  });

  it('Created reads a day either side and keeps the local days', async () => {
    const { service, repository } = build([deal('c1', { createdAt: '2026-09-01T03:00:00.000Z', commissionSnapshot: snapshot({}) }), deal('c2', { createdAt: '2026-09-01T12:00:00.000Z', commissionSnapshot: snapshot({}) })]);
    const r = await service.report({ ...sept, by: 'created' }, office, 'all');
    expect(repository.findDoneByCreated).toHaveBeenCalledWith('2026-08-31', '2026-09-28T23:59:59.999Z');
    expect(r.rows.map((x) => x.dealNumber)).toEqual(['C2']);
  });

  it('computes only the jobs done here: their ledgers and their technicians’ rates', async () => {
    const { service, client } = build();
    const r = await service.report(sept, office, 'all');
    expect(client.ledgers).toHaveBeenCalledWith(['n1']);
    expect(client.commissionHistories).toHaveBeenCalledWith(['cat']);
    const native = r.rows.find((x) => x.dealNumber === 'N1')!;
    // (400 − 20 parts − 400 × 5 % fee) × 40 %
    expect(native).toMatchObject({ source: 'computed', credit: 400, parts: 20, fees: 20, techProfit: 144, techName: 'Cat Moe' });
    expect(r.computedRows).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it('Totals cover the whole filtered set, the page only its slice', async () => {
    const { service } = build();
    const r = await service.report({ ...sept, limit: '2', sort: 'total', dir: 'desc' }, office, 'all');
    expect(r.rows.map((x) => x.dealNumber)).toEqual(['N1', 'B1']);
    expect(r.count).toBe(4);
    expect(r.totals.total).toEqual({ amount: 710, jobs: 4 });
  });

  it('the technician filter narrows the rows, not the technician list (“[N]”)', async () => {
    const { service } = build();
    const r = await service.report({ ...sept, mode: 'tech', techId: 'ann' }, office, 'all');
    expect(r.rows.map((x) => x.dealNumber).sort()).toEqual(['A1', 'M1']);
    expect(r.techs.map((t) => [t.techName, t.jobs])).toEqual([
      ['Ann Lee', 2],
      ['Bob Ray', 1],
      ['Cat Moe', 1],
    ]);
    // A shared job is its primary's only: B1 is Bob's although Ann is on it.
    // Ann kept the cash of both jobs: (50 − 100) + (5 − 10).
    expect(r.totals.balance.amount).toBe(-55);
  });

  it('names the clients of the page only', async () => {
    const { service, client } = build();
    const r = await service.report({ ...sept, limit: '1', sort: 'dealNumber' }, office, 'all');
    expect(client.contactNames).toHaveBeenCalledWith(['contact-a1']);
    expect(r.rows[0].clientName).toBe('Client contact-a1');
  });

  it('a search can find a client, so the whole period is named first', async () => {
    const { service } = build();
    const r = await service.report({ ...sept, q: 'contact-b1' }, office, 'all');
    expect(r.rows.map((x) => x.dealNumber)).toEqual(['B1']);
  });

  it('says so when payments or rates could not be read, instead of silent zeros', async () => {
    const { service, client } = build();
    client.ledgers.mockResolvedValue(null);
    client.commissionHistories.mockResolvedValue(null);
    const r = await service.report(sept, office, 'all');
    expect(r.warnings).toHaveLength(2);
    expect(r.rows.find((x) => x.dealNumber === 'N1')).toMatchObject({ credit: 0, techProfit: 0 });
  });

  it('a technician (assigned_only) reads their own period off the tech index, primary jobs only', async () => {
    const { service, repository } = build();
    const r = await service.report(sept, createMockJwtUser({ id: 'ann' }), 'assigned_only');
    expect(repository.findDoneByTech).toHaveBeenCalledWith('ann', '2026-08-01', '2026-09-27');
    expect(repository.findDoneByVisitStart).not.toHaveBeenCalled();
    expect(r.rows.map((x) => x.dealNumber).sort()).toEqual(['A1', 'M1']);
    expect(r.techs.map((t) => t.techId)).toEqual(['ann']);
  });

  it('one read of a period serves a minute of paging and switching technicians; fresh re-reads', async () => {
    const { service, repository } = build();
    await service.report(sept, office, 'all');
    await service.report({ ...sept, mode: 'tech', techId: 'bob', offset: '0' }, office, 'all');
    expect(repository.findDoneByVisitStart).toHaveBeenCalledTimes(1);
    await service.report({ ...sept, fresh: '1' }, office, 'all');
    expect(repository.findDoneByVisitStart).toHaveBeenCalledTimes(2);
  });

  it('a truncated read is flagged', async () => {
    const { service, repository } = build();
    repository.findDoneByVisitStart.mockResolvedValue({ items: [IMPORTED_ANN], truncated: true });
    const r = await service.report(sept, office, 'all');
    expect(r.truncated).toBe(true);
    expect(r.warnings[0]).toMatch(/floor/);
  });
});

describe('CommissionReportService.exportCsv', () => {
  it('every filtered row, with client names, named after the mode and period', async () => {
    const { service } = build();
    const { filename, csv } = await service.exportCsv({ ...sept, mode: 'tech', techId: 'ann' }, office, 'all');
    expect(filename).toBe('commissions_tech_Ann_Lee_closed_2026-09-01_2026-09-27.csv');
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1].startsWith('Totals:2,')).toBe(true);
    expect(csv).toContain('Client contact-a1');
  });
});
