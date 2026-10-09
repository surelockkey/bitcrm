import { COMMISSION_REPORT_TOTAL_KEYS, type CommissionConfig, type CommissionReportRow, type WorkizCommissionSnapshot } from '@bitcrm/types';
import {
  buildRow,
  commissionReportCsv,
  endDayOf,
  externalSummaries,
  inPeriod,
  matchesFilters,
  matchesSearch,
  primaryTechOf,
  reportDayOf,
  snapshotShareExact,
  sortRows,
  techSummaries,
  totalsOf,
  withoutMoney,
  type RowContext,
} from 'src/commission-report/commission-report.rows';
import type { CommissionDealItem } from 'src/commission-report/commission-report.types';

/** TGQ6NS as the Workiz import wrote it (Moshe Szender, 50 %, card fee 2.91 %). */
const TGQ6NS_SNAPSHOT: WorkizCommissionSnapshot = {
  source: 'workiz_commissions_report',
  capturedAt: '2026-09-29T19:42:46+00:00',
  techId: 'moshe',
  workizTechId: '406615',
  rate: 50,
  rateUnit: '%',
  rateSource: 'tech',
  total: 197.17,
  tax: 11.43,
  tip: 0,
  parts: 82.74,
  companyParts: 0,
  techProfit: 48.63,
  companyProfit: 54.37,
  externalCompanyProfit: 0,
  paid: { cash: 0, credit: 197.17, check: 0 },
  billing: 0,
  cashByExternal: 0,
  closedLocal: '2026-09-02T19:00',
};

function item(overrides: Partial<CommissionDealItem> = {}): CommissionDealItem {
  return {
    id: 'deal-1',
    dealNumber: 'TGQ6NS',
    contactId: 'contact-1',
    assignedTechIds: ['moshe'],
    createdAt: '2026-07-28T15:48:08.000Z',
    scheduledDate: '2026-09-02',
    scheduledEndDate: '2026-09-02',
    scheduledTimeSlot: '18:00-19:00',
    jobTypeId: 'jt-door',
    address: { street: '215 Main St', city: 'Norwalk', state: 'Connecticut', zip: '06851' },
    serviceArea: 'SURE LOCK CT',
    serviceAreaId: 'area-ct',
    sourceId: 'src-google',
    superStatus: 'done',
    status: 'active',
    jobTimezone: 'America/New_York',
    ...overrides,
  };
}

const config = (overrides: Partial<CommissionConfig> = {}): CommissionConfig => ({
  userId: 'tech-new',
  baseRatePct: 50,
  creditCardFeePct: 3,
  achFeePct: 0,
  effectiveDate: '2026-01-01T00:00:00.000Z',
  createdBy: 'u',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function ctx(overrides: Partial<RowContext> = {}): RowContext {
  return {
    techNames: new Map([
      ['moshe', 'Moshe Szender'],
      ['tech-new', 'New Tech'],
    ]),
    jobTypeNames: new Map([['jt-door', '(A-1) Door Service']]),
    sourceNames: new Map([['src-google', 'Google']]),
    externalCompanyNames: new Map([['ext-1', 'Partner LLC']]),
    partsFields: { tech: 'cf-tech-parts', company: 'cf-company-parts' },
    payments: new Map(),
    configs: new Map(),
    ...overrides,
  };
}

describe('which Done jobs a period holds', () => {
  it('Closed is the END of the visit window, Scheduled its start', () => {
    const multiDay = item({ scheduledDate: '2026-08-28', scheduledEndDate: '2026-09-01' });
    expect(endDayOf(multiDay)).toBe('2026-09-01');
    expect(inPeriod(multiDay, 'closed', '2026-09-01', '2026-09-27')).toBe(true);
    expect(inPeriod(multiDay, 'scheduled', '2026-09-01', '2026-09-27')).toBe(false);
  });

  it('a job without an end day closes on its visit day', () => {
    expect(endDayOf(item({ scheduledEndDate: undefined }))).toBe('2026-09-02');
  });

  it('Created is the local day in the job’s zone, not the UTC one', () => {
    const lateEvening = item({ createdAt: '2026-09-01T02:30:00.000Z' });
    expect(reportDayOf(lateEvening, 'created')).toBe('2026-08-31');
    expect(inPeriod(lateEvening, 'created', '2026-09-01', '2026-09-27')).toBe(false);
    expect(reportDayOf(item({ createdAt: '2026-09-01T02:30:00.000Z', jobTimezone: undefined }), 'created')).toBe('2026-08-31');
  });

  it('a job shared by several technicians is its primary’s', () => {
    expect(primaryTechOf(item({ assignedTechIds: ['a', 'b'] }))).toBe('a');
    expect(primaryTechOf(item({ assignedTechIds: ['b', 'a'], commissionSnapshot: { ...TGQ6NS_SNAPSHOT, techId: 'a' } }))).toBe('a');
    expect(primaryTechOf(item({ assignedTechIds: [] }))).toBeUndefined();
  });
});

describe('buildRow — an imported job keeps Workiz’s frozen numbers', () => {
  const row = buildRow(item({ commissionSnapshot: TGQ6NS_SNAPSHOT }), ctx());

  it('copies the row as Workiz printed it', () => {
    expect(row).toMatchObject({
      dealNumber: 'TGQ6NS',
      techId: 'moshe',
      techName: 'Moshe Szender',
      jobTypeName: '(A-1) Door Service',
      address: '215 Main St, Norwalk, Connecticut, 06851',
      closedDate: '2026-09-02',
      closedTime: '19:00',
      total: 197.17,
      credit: 197.17,
      billing: 0,
      rate: 50,
      rateUnit: '%',
      rateSource: 'tech',
      parts: 82.74,
      techProfit: 48.63,
      companyProfit: 54.37,
      tax: 11.43,
      source: 'workiz',
    });
  });

  it('owes the technician their profit plus the parts they bought', () => {
    expect(row.balance).toBe(131.37);
  });

  it('a half-cent share (both shares rounded up) is balanced from the exact half, as Workiz does', () => {
    const halfCent = { ...TGQ6NS_SNAPSHOT, total: 2386.97, tax: 0, parts: 0, companyParts: 493, techProfit: 946.99, companyProfit: 946.99 };
    expect(snapshotShareExact(halfCent)).toBeCloseTo(946.985, 9);
    expect(snapshotShareExact(TGQ6NS_SNAPSHOT)).toBe(48.63);
    // The technician kept the cash: −1 439.985 rounds away from zero.
    const r = buildRow(item({ commissionSnapshot: { ...halfCent, paid: { cash: 2386.97, credit: 0, check: 0 } } }), ctx());
    expect(r.balance).toBe(-1439.99);
    expect(r.techProfit).toBe(946.99);
  });

  it('never recomputes — even when today’s rate differs', () => {
    const r = buildRow(item({ commissionSnapshot: TGQ6NS_SNAPSHOT }), ctx({ configs: new Map([['moshe', [config({ baseRatePct: 10 })]]]) }));
    expect(r.techProfit).toBe(48.63);
  });
});

describe('buildRow — a job done in BitCRM goes through the Workiz formula', () => {
  const native = (overrides: Partial<CommissionDealItem> = {}) =>
    item({
      id: 'deal-new',
      dealNumber: 'K4T9ZW',
      assignedTechIds: ['tech-new', 'helper'],
      totals: { subtotal: 300, discount: 0, tax: 20, total: 320, cost: 0 },
      customFields: { 'cf-tech-parts': 40, 'cf-company-parts': 30 },
      ...overrides,
    });
  const ledger = new Map([
    [
      'deal-new',
      [
        { method: 'card', status: 'settled', amount: 200, refundedAmount: 0, tipAmount: 10 },
        { method: 'cash', status: 'settled', amount: 120, refundedAmount: 0 },
      ] as never,
    ],
  ]);

  it('takes the ledger, the tip on it, the parts fields and the rate in force', () => {
    const r = buildRow(native(), ctx({ payments: ledger, configs: new Map([['tech-new', [config()]]]) }));
    // total = 320 + 10 tip; credit = 210, cash = 120; fee = 210 × 3 % = 6.30
    // tech = (330 − 20 − 10 − 40 − 30 − 6.30) × 50 % + 10 = 121.85
    expect(r).toMatchObject({
      total: 330,
      cash: 120,
      credit: 210,
      check: 0,
      billing: 0,
      tip: 10,
      parts: 40,
      companyParts: 30,
      fees: 6.3,
      rate: 50,
      rateSource: 'tech',
      techProfit: 121.85,
      companyProfit: 118.15,
      balance: 41.85,
      techIds: ['tech-new', 'helper'],
      source: 'computed',
    });
  });

  it('uses the version in force on the job’s closing day', () => {
    const history = [config({ baseRatePct: 30 }), config({ baseRatePct: 35, effectiveDate: '2026-09-04T00:00:00.000Z' })];
    const before = buildRow(native({ scheduledDate: '2026-09-03', scheduledEndDate: '2026-09-03' }), ctx({ configs: new Map([['tech-new', history]]) }));
    const after = buildRow(native({ scheduledDate: '2026-09-05', scheduledEndDate: '2026-09-05' }), ctx({ configs: new Map([['tech-new', history]]) }));
    expect(before.rate).toBe(30);
    expect(after.rate).toBe(35);
  });

  it('a job’s own fixed rate wins over the technician’s', () => {
    const r = buildRow(
      native({ useTechSpecialRate: true, techSpecialRate: 165, techSpecialRateUnit: '$' }),
      ctx({ payments: ledger, configs: new Map([['tech-new', [config()]]]) }),
    );
    expect(r).toMatchObject({ rate: 165, rateUnit: '$', rateSource: 'special', techProfit: 175 });
  });

  it('an imported job without a snapshot keeps Workiz’s totals (tip inside) and its parts attributes', () => {
    const r = buildRow(
      native({
        totals: { subtotal: 280, discount: 0, tax: 17.78, total: 368.06, cost: 15, tip: 59.56 },
        parts: 15,
        companyParts: 0,
        customFields: { 'cf-tech-parts': 999 },
      }),
      ctx({
        payments: new Map([['deal-new', [{ method: 'card', status: 'settled', amount: 308.5, refundedAmount: 0, tipAmount: 59.56 }] as never]]),
        configs: new Map([['tech-new', [config({ baseRatePct: 40, creditCardFeePct: 6 })]]]),
      }),
    );
    expect(r).toMatchObject({ total: 368.06, tip: 59.56, parts: 15, credit: 368.06, techProfit: 161.01, companyProfit: 174.27 });
  });

  it('without a technician or payments the job is the company’s and fully open', () => {
    const r = buildRow(native({ assignedTechIds: [] }), ctx());
    expect(r).toMatchObject({ techProfit: 0, rateSource: 'none', billing: 320, cash: 0 });
    expect(r.techId).toBeUndefined();
  });
});

describe('filters, totals and slices', () => {
  const row = (o: Partial<CommissionReportRow>): CommissionReportRow =>
    ({
      dealId: 'd',
      dealNumber: 'A',
      techIds: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      address: '',
      total: 0,
      cash: 0,
      credit: 0,
      billing: 0,
      check: 0,
      rateSource: 'tech',
      tip: 0,
      parts: 0,
      companyParts: 0,
      techProfit: 0,
      externalCompanyProfit: 0,
      companyProfit: 0,
      tax: 0,
      cashByExternal: 0,
      creditByExternal: 0,
      billingByExternal: 0,
      checkByExternal: 0,
      balance: 0,
      source: 'workiz',
      ...o,
    }) as CommissionReportRow;
  const a = row({ dealNumber: 'A1', techId: 't1', techName: 'Ann', total: 100, cash: 100, techProfit: 50, balance: -50, jobTypeId: 'jt1', closedDate: '2026-09-02' });
  const b = row({ dealNumber: 'B2', techId: 't2', techName: 'Bob', total: 200, credit: 150, billing: 50, techProfit: 60, balance: 60, externalCompanyId: 'ext-1', externalCompanyProfit: 5, closedDate: '2026-09-01' });
  const c = row({ dealNumber: 'C3', techId: 't1', techName: 'Ann', total: 0, closedDate: '2026-09-03' });

  it('filter by technician, job type, external company (or any company)', () => {
    expect([a, b, c].filter((r) => matchesFilters(r, { mode: 'standard', techId: 't1' }))).toEqual([a, c]);
    expect([a, b, c].filter((r) => matchesFilters(r, { mode: 'standard', jobTypeId: 'jt1' }))).toEqual([a]);
    expect([a, b, c].filter((r) => matchesFilters(r, { mode: 'standard', externalCompanyId: 'only' }))).toEqual([b]);
    expect([a, b, c].filter((r) => matchesFilters(r, { mode: 'standard', techId: 't1' }, 'tech'))).toEqual([a, b, c]);
  });

  it('search any text column', () => {
    expect(matchesSearch(a, 'ann')).toBe(true);
    expect(matchesSearch(a, 'b2')).toBe(false);
    expect(matchesSearch(b, 'B2')).toBe(true);
    expect(matchesSearch(b, '  ')).toBe(true);
  });

  it('sums every column and counts the rows with a positive amount (Workiz’s “(N Jobs)”)', () => {
    const t = totalsOf([a, b, c]);
    expect(t.total).toEqual({ amount: 300, jobs: 2 });
    expect(t.cash).toEqual({ amount: 100, jobs: 1 });
    expect(t.billing).toEqual({ amount: 50, jobs: 1 });
    // −50 and +60: only the positive one is counted.
    expect(t.balance).toEqual({ amount: 10, jobs: 1 });
    expect(t.externalCompanyProfit).toEqual({ amount: 5, jobs: 1 });
  });

  it('per technician and per external company', () => {
    expect(techSummaries([a, b, c])).toEqual([
      expect.objectContaining({ techId: 't1', techName: 'Ann', jobs: 2, total: 100, techProfit: 50, balance: -50 }),
      expect.objectContaining({ techId: 't2', techName: 'Bob', jobs: 1, total: 200, techProfit: 60, balance: 60 }),
    ]);
    expect(externalSummaries([a, b, c])).toEqual([{ externalCompanyId: 'ext-1', externalCompanyName: undefined, jobs: 1, total: 200, profit: 5 }]);
  });

  it('sorts by a column, then by the closing moment', () => {
    expect(sortRows([a, b, c], 'closedDate', 'asc').map((r) => r.dealNumber)).toEqual(['B2', 'A1', 'C3']);
    expect(sortRows([a, b, c], 'total', 'desc').map((r) => r.dealNumber)).toEqual(['B2', 'A1', 'C3']);
    expect(sortRows([a, b, c], 'techName', 'asc').map((r) => r.dealNumber)).toEqual(['A1', 'C3', 'B2']);
  });

  it('exports a header, a Totals line and one line per row; quotes what needs it', () => {
    const csv = commissionReportCsv([a, { ...b, address: '1 Main St, "Unit 2"' }], totalsOf([a, b]), 'standard').split('\r\n');
    expect(csv).toHaveLength(4);
    expect(csv[0].startsWith('Job Id,Tech,Created,Scheduled,Closed,Job Type,Address,Total,Cash,Credit,Billing,Check,Tech Share')).toBe(true);
    expect(csv[1].startsWith('Totals:2,')).toBe(true);
    expect(csv[1]).toContain('300.00 (2 Jobs)');
    expect(csv[3]).toContain('"1 Main St, ""Unit 2"""');
  });

  it('the Tech export carries the running balance, not the company profit', () => {
    const header = commissionReportCsv([a], totalsOf([a]), 'tech').split('\r\n')[0];
    expect(header).toContain('Balance Tech');
    expect(header).not.toContain('Company Profit');
    expect(header).not.toContain('Scheduled');
  });

  it('without financials.view the export keeps the jobs and drops every amount and rate', () => {
    const csv = commissionReportCsv([a, b], totalsOf([a, b]), 'standard', false).split('\r\n');
    expect(csv[0]).toBe('Job Id,Tech,Created,Scheduled,Closed,Job Type,Address,Client,Ad Group,External Company');
    expect(csv[1]).toBe('Totals:2,,,,,,,,,');
    expect(csv.join('\n')).not.toMatch(/\d\.\d\d/);
  });

  it('withoutMoney zeroes every amount and drops the rate and the fees — the job, its people and its dates stay', () => {
    const row = withoutMoney({ ...a, rate: 50, rateUnit: '%', fees: 3 });
    for (const key of COMMISSION_REPORT_TOTAL_KEYS) expect(row[key]).toBe(0);
    expect(row.rate).toBeUndefined();
    expect(row.rateUnit).toBeUndefined();
    expect(row.fees).toBeUndefined();
    expect(row).toMatchObject({ dealNumber: a.dealNumber, techName: a.techName, address: a.address, closedDate: a.closedDate });
  });
});
