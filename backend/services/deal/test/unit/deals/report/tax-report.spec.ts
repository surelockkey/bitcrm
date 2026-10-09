import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { TaxReportController, TaxReportQueryDto } from 'src/deals/report/tax-report.controller';
import { TaxReportService } from 'src/deals/report/tax-report.service';
import { TaxReportRepository } from 'src/deals/report/tax-report.repository';
import {
  accrualRows,
  dealTaxFigures,
  paidRows,
  paidShare,
  sortTaxRows,
  taxCsvLine,
} from 'src/deals/report/tax-report.rules';
import { createMockJwtUser } from '../../mocks';

const owner = { user: createMockJwtUser({ id: 'owner' }), perms: { permissions: { financials: { view: true } } } as never };

/** A Workiz-imported job as the import writes it (Workiz's own figures, `totals.source: workiz`). */
const imported = (over: Record<string, unknown> = {}) => ({
  id: 'd-1',
  taxRateName: 'CT',
  taxRatePercent: 6.35,
  taxSource: 'manual',
  totals: { subtotal: 224.99, discount: 0, tax: 14.29, total: 239.28, source: 'workiz' },
  taxAmount: 14.29,
  taxableAmount: 224.99,
  subTotal: 224.99,
  jobTotalPrice: 239.28,
  createdAt: '2026-08-27T16:24:24.000Z',
  scheduledDate: '2026-09-14',
  scheduledEndDate: '2026-09-14',
  scheduledTimeSlot: '11:15-12:54',
  jobDateUtc: '2026-09-14T15:15:00.000Z',
  jobEndDateUtc: '2026-09-14T16:54:48.000Z',
  jobTimezone: 'America/New_York',
  assignedTechIds: ['tech-1'],
  ...over,
});

describe('Tax report rules (Workiz, verified live 2026-09-29)', () => {
  it('reads Workiz’s own figures on an imported job, the snapshot on one priced here', () => {
    expect(dealTaxFigures(imported())).toMatchObject({ key: 'CT|6.35', tax: 14.29, taxable: 224.99, subtotal: 224.99, total: 239.28 });
    const native = dealTaxFigures(
      imported({ totals: { subtotal: 200, discount: 20, tax: 9, total: 189, taxableBase: 90 }, taxRatePercent: 10, taxRateName: 'TX' }),
    );
    expect(native).toMatchObject({ key: 'TX|10', tax: 9, taxable: 90, subtotal: 200, total: 189 });
  });

  it('derives the base from the tax on a snapshot written before it was kept', () => {
    expect(dealTaxFigures(imported({ totals: { subtotal: 100, tax: 6.35, total: 106.35 } }))).toMatchObject({ taxable: 100 });
  });

  it('leaves out a job with no tax, and an exempt one', () => {
    expect(dealTaxFigures(imported({ taxAmount: 0, totals: { tax: 0, source: 'workiz' } }))).toBeNull();
    expect(dealTaxFigures(imported({ taxSource: 'exempt' }))).toBeNull();
  });

  it('sums a rate’s jobs; non-taxable goes negative when a discount outweighs the untaxed lines', () => {
    const rows = accrualRows([
      dealTaxFigures(imported({ id: 'a', taxAmount: 63.5, taxableAmount: 1000, subTotal: 900 }))!, // discount took 100 off
      dealTaxFigures(imported({ id: 'b', taxAmount: 6.35, taxableAmount: 100, subTotal: 150 }))!,
    ]);
    expect(rows).toEqual([
      { key: 'CT|6.35', name: 'CT', description: '', rate: 6.35, ratePercent: 6.35, amount: 69.85, taxableAmount: 1100, nonTaxableAmount: -50, jobs: 2 },
    ]);
  });

  it('prints the rate with two places and keeps AZ 8.60 apart from a disabled AZ 5.6', () => {
    const rows = accrualRows([
      dealTaxFigures(imported({ taxRateName: 'SURE NY', taxRatePercent: 8.875, taxAmount: 8.88 }))!,
      dealTaxFigures(imported({ id: 'x', taxRateName: 'AZ', taxRatePercent: 8.6, taxAmount: 8.6 }))!,
      dealTaxFigures(imported({ id: 'y', taxRateName: 'AZ', taxRatePercent: 5.6, taxAmount: 5.6 }))!,
    ]);
    expect(rows.find((r) => r.name === 'SURE NY')!.rate).toBe(8.88);
    expect(rows.filter((r) => r.name === 'AZ').map((r) => r.rate).sort()).toEqual([5.6, 8.6]);
  });

  it('Paid: taxable × rate × min(1, collected / total), the full taxable base, one job each', () => {
    const f = dealTaxFigures(imported({ taxRatePercent: 10, taxAmount: 100, taxableAmount: 1000, jobTotalPrice: 1100 }))!;
    expect(paidShare(f, 550)).toBe(50);
    expect(paidShare(f, 5000)).toBe(100);
    expect(paidShare(f, 0)).toBeNull();
    expect(paidShare(f, -20)).toBeNull(); // a period that only refunded
    const rows = paidRows([
      { figures: f, collected: 550 },
      { figures: { ...f, dealId: 'z' }, collected: -1 },
    ]);
    expect(rows).toEqual([{ key: 'CT|10', name: 'CT', description: '', rate: 10, ratePercent: 10, amount: 50, taxableAmount: 1000, jobs: 1 }]);
  });

  // Workiz's own Paid figures for 2026-09-01..27 (live 2026-09-29) against the
  // jobs of the parser dump: the tax is worked out from the taxable base and the
  // rate, summed unrounded and rounded once — not the jobs' stored tax rounded
  // job by job (that gives 202.14 and 906.70).
  const paidJob = (id: string, name: string, percent: number, tax: number, taxable: number, total: number, collected: number) => ({
    figures: dealTaxFigures(imported({ id, taxRateName: name, taxRatePercent: percent, taxAmount: tax, taxableAmount: taxable, subTotal: taxable, jobTotalPrice: total }))!,
    collected,
  });

  it('Paid: SURE NY 202.15 as Workiz (two jobs paid in part)', () => {
    const rows = paidRows([
      paidJob('0K1Q35', 'SURE NY', 8.875, 15.97, 179.99, 191.42, 191.42),
      paidJob('GG7SCI', 'SURE NY', 8.875, 91.68, 1033, 1158.43, 553.98),
      paidJob('P7C8II', 'SURE NY', 8.875, 73.56, 828.83, 929.46, 374.27),
      paidJob('HACQG6', 'SURE NY', 8.875, 39.94, 450.06, 490, 490),
      paidJob('906MUL', 'SURE NY', 8.875, 46.59, 525, 588.74, 588.74),
      paidJob('3Z4PCL', 'SURE NY', 8.875, 26.18, 295, 330.82, 330.82),
    ]);
    expect(rows).toEqual([
      { key: 'SURE NY|8.875', name: 'SURE NY', description: '', rate: 8.88, ratePercent: 8.875, amount: 202.15, taxableAmount: 3311.88, jobs: 6 },
    ]);
  });

  it('Paid: IL CHICAGO 906.69 as Workiz (every job paid in full)', () => {
    const rows = paidRows([
      paidJob('DITZFR', 'IL CHICAGO', 10.25, 296.41, 2891.79, 4538.76, 4538.76),
      paidJob('WPQTPB', 'IL CHICAGO', 10.25, 19.43, 189.58, 550.39, 550.39),
      paidJob('F92AJA', 'IL CHICAGO', 10.25, 27.3, 266.35, 795.27, 795.27),
      paidJob('MASLSY', 'IL CHICAGO', 10.25, 363.88, 3550, 3913.88, 3913.88),
      paidJob('E8KXSS', 'IL CHICAGO', 10.25, 20.5, 200, 220.5, 220.5),
      paidJob('GNADB7', 'IL CHICAGO', 10.25, 25.63, 250, 250, 250),
      paidJob('WXSO7X', 'IL CHICAGO', 10.25, 30.75, 300, 330.75, 330.75),
      paidJob('D8SXQR', 'IL CHICAGO', 10.25, 122.8, 1198, 1350.79, 1350.79),
    ]);
    expect(rows[0]).toMatchObject({ amount: 906.69, taxableAmount: 8845.72, jobs: 8 });
  });

  it('orders the tabs as Workiz does: Accrual A→Z, Paid Z→A', () => {
    const rows = accrualRows(['CT', 'AZ', 'SURE NY'].map((n, i) => dealTaxFigures(imported({ id: `r${i}`, taxRateName: n }))!));
    expect(sortTaxRows(rows, 'accrual').map((r) => r.name)).toEqual(['AZ', 'CT', 'SURE NY']);
    expect(sortTaxRows(rows, 'paid').map((r) => r.name)).toEqual(['SURE NY', 'CT', 'AZ']);
  });

  it('writes Workiz’s CSV: bare numbers, Non-taxable only on Accrual', () => {
    const row = { key: 'CT|6.35', name: 'CT', description: '', rate: 6.35, ratePercent: 6.35, amount: 11558.93, taxableAmount: 182025.53, nonTaxableAmount: -981.16, jobs: 403 };
    expect(taxCsvLine(row, 'accrual')).toBe('CT,,6.35,11558.93,182025.53,-981.16,403');
    expect(taxCsvLine(row, 'paid')).toBe('CT,,6.35,11558.93,182025.53,403');
  });
});

describe('TaxReportService', () => {
  function make(
    windowRows: Record<string, unknown>[] = [],
    byIds: Record<string, unknown>[] = [],
    paid: Array<{ dealId: string; paid: number }> = [],
    accountRates: Array<{ name: string; ratePercent: number; active: boolean }> = [],
  ) {
    const repo = { window: jest.fn(async () => windowRows), byIds: jest.fn(async () => byIds) };
    const billing = { paidByJob: jest.fn(async () => paid) };
    const rates = { listAll: jest.fn(async () => accountRates) };
    return {
      service: new TaxReportService(repo as unknown as TaxReportRepository, billing as never, rates as never),
      repo,
      billing,
      rates,
    };
  }

  it('needs financials.view', async () => {
    const { service } = make();
    await expect(service.report({ from: '2026-09-01', to: '2026-09-27' }, { user: createMockJwtUser(), perms: { permissions: {} } as never })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('windows Accrual on the job END day by default, on the account’s calendar', async () => {
    const { service, repo } = make([
      imported({ id: 'in' }),
      // Ends at 00:30 Eastern on the 28th (23:30 in Dallas on the 27th): outside 1–27.
      imported({ id: 'edge', scheduledDate: '2026-09-27', scheduledEndDate: '2026-09-27', jobEndDateUtc: '2026-09-28T04:30:00.000Z', jobTimezone: 'America/Chicago' }),
    ]);
    const r = await service.report({ from: '2026-09-01', to: '2026-09-27' }, owner);
    expect(repo.window).toHaveBeenCalledWith('end', '2026-09-01', '2026-09-27');
    expect(r).toMatchObject({ basis: 'accrual', by: 'end', totalAmount: 14.29, taxes: [{ key: 'CT|6.35', name: 'CT', rate: 6.35 }] });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].jobs).toBe(1);
  });

  it('reads the window of the chosen "By:"', async () => {
    const { service, repo } = make([imported()]);
    await service.report({ from: '2026-08-01', to: '2026-08-31', by: 'created' }, owner);
    expect(repo.window).toHaveBeenCalledWith('created', '2026-08-01', '2026-08-31');
  });

  it('Paid: asks billing what each job collected, then reads those jobs', async () => {
    const { service, repo, billing } = make(
      [],
      [
        imported({ id: 'a', taxRatePercent: 10, taxAmount: 90, jobTotalPrice: 990, taxableAmount: 900 }),
        imported({ id: 'b', taxRatePercent: 10, taxAmount: 10, jobTotalPrice: 110, taxableAmount: 100 }),
      ],
      [
        { dealId: 'a', paid: 495 },
        { dealId: 'b', paid: 110 },
        { dealId: 'c', paid: -5 },
      ],
    );
    const r = await service.report({ basis: 'paid', from: '2026-09-01', to: '2026-09-27' }, owner);
    expect(billing.paidByJob).toHaveBeenCalledWith('2026-09-01', '2026-09-27');
    expect(repo.byIds).toHaveBeenCalledWith(['a', 'b']);
    expect(r.by).toBeUndefined();
    expect(r.rows[0]).toMatchObject({ amount: 55, taxableAmount: 1000, jobs: 2 });
    expect(r.totalAmount).toBe(55);
  });

  it('keeps an assigned-only reader to their own jobs', async () => {
    const { service } = make([imported({ id: 'mine', assignedTechIds: ['tech-1'] }), imported({ id: 'theirs', assignedTechIds: ['tech-2'] })]);
    const r = await service.report(
      { from: '2026-09-01', to: '2026-09-27' },
      { user: createMockJwtUser({ id: 'tech-1' }), perms: { permissions: { financials: { view: true } }, dataScope: { deals: 'assigned_only' } } as never },
    );
    expect(r.rows[0].jobs).toBe(1);
  });

  it('filters by "Tax to show" and search, but still lists every rate as an option', async () => {
    const { service } = make([imported({ id: 'a' }), imported({ id: 'b', taxRateName: 'SURE LOCK TX', taxRatePercent: 8.25 })]);
    const r = await service.report({ from: '2026-09-01', to: '2026-09-27', tax: 'SURE LOCK TX|8.25' }, owner);
    expect(r.rows.map((x) => x.name)).toEqual(['SURE LOCK TX']);
    expect(r.taxes).toHaveLength(2);
    const s = await service.report({ from: '2026-09-01', to: '2026-09-27', search: 'ct' }, owner);
    expect(s.rows.map((x) => x.name)).toEqual(['CT']);
  });

  it('offers every tax the account has in "Tax to show" — archived ones and the window’s own too — once per name and rate, A→Z', async () => {
    // Workiz lists all the account's taxes (`crud.taxes`), not just the period's.
    // Ours live on service areas, several areas sharing one tax.
    const { service } = make(
      [imported({ id: 'a' }), imported({ id: 'b', taxRateName: 'AL Jefferson', taxRatePercent: 10 })],
      [],
      [],
      [
        { name: 'SURE NY', ratePercent: 8.875, active: true },
        { name: 'CT', ratePercent: 6.35, active: true },
        { name: 'CT', ratePercent: 6.35, active: true },
        { name: 'AZ', ratePercent: 8.6, active: true },
        { name: 'AZ', ratePercent: 5.6, active: false },
        { name: 'IL CHICAGO ', ratePercent: 10.25, active: true },
      ],
    );
    const r = await service.report({ from: '2026-09-01', to: '2026-09-27' }, owner);
    expect(r.taxes).toEqual([
      { key: 'AL Jefferson|10', name: 'AL Jefferson', rate: 10 },
      { key: 'AZ|5.6', name: 'AZ', rate: 5.6 },
      { key: 'AZ|8.6', name: 'AZ', rate: 8.6 },
      { key: 'CT|6.35', name: 'CT', rate: 6.35 },
      { key: 'IL CHICAGO|10.25', name: 'IL CHICAGO', rate: 10.25 },
      { key: 'SURE NY|8.875', name: 'SURE NY', rate: 8.88 },
    ]);
  });

  it('still answers when the account’s taxes cannot be read — the window’s rates are the options', async () => {
    const { service, rates } = make([imported()]);
    rates.listAll.mockRejectedValueOnce(new Error('service areas down'));
    const r = await service.report({ from: '2026-09-01', to: '2026-09-27' }, owner);
    expect(r.taxes).toEqual([{ key: 'CT|6.35', name: 'CT', rate: 6.35 }]);
  });

  it('refuses a period longer than Workiz allows', async () => {
    const { service } = make();
    await expect(service.report({ from: '2025-01-01', to: '2026-09-27' }, owner)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.report({ from: '2026-09-27', to: '2026-09-01' }, owner)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exports Workiz’s CSV for the tab', async () => {
    const { service } = make([imported()]);
    const out = await service.exportCsv({ from: '2026-09-01', to: '2026-09-27' }, owner);
    expect(out.filename).toBe('tax-accrual-2026-09-01_2026-09-27.csv');
    expect(out.csv.split('\n')).toEqual(['Name,Description,Rate,Amount,Taxable amount,Non taxable amount,Jobs count', 'CT,,6.35,14.29,224.99,0.00,1']);
  });
});

describe('TaxReportController', () => {
  it('is registered ahead of DealsController, at report/tax', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(TaxReportController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(TaxReportController)).toBeLessThan(controllers.indexOf(DealsController));
    expect(Reflect.getMetadata(PATH_METADATA, TaxReportController)).toBe('report/tax');
  });

  it('validates the query: both days required, known tabs and "By:" only', async () => {
    const errors = async (q: Record<string, unknown>) => validate(plainToInstance(TaxReportQueryDto, q));
    expect(await errors({ from: '2026-09-01', to: '2026-09-27', basis: 'paid', by: 'end' })).toHaveLength(0);
    expect((await errors({ from: '2026-09-01' })).length).toBeGreaterThan(0);
    expect((await errors({ from: '2026-09-01', to: '2026-09-27', basis: 'cash' })).length).toBeGreaterThan(0);
    expect((await errors({ from: '2026-09-01', to: '2026-09-27', by: 'closed' })).length).toBeGreaterThan(0);
    expect(new ValidationPipe()).toBeDefined();
  });

  it('wraps the answer in the envelope', async () => {
    const service = { report: jest.fn(async () => ({ rows: [] })), exportCsv: jest.fn(async () => ({ csv: '' })) };
    const controller = new TaxReportController(service as never);
    const user = createMockJwtUser();
    await expect(controller.report({ from: '2026-09-01', to: '2026-09-27' } as never, user, {} as never)).resolves.toEqual({ success: true, data: { rows: [] } });
    expect(service.report).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-27' }, { user, perms: {} });
  });
});

describe('TaxReportRepository', () => {
  it('reads the Accrual window through the Jobs report’s window read, tax fields only', async () => {
    const deals = { readReportWindow: jest.fn(async () => []) };
    const repo = new TaxReportRepository(deals as never, { client: { send: jest.fn() } } as never);
    await repo.window('end', '2026-09-01', '2026-09-27');
    const [by, from, to, projection] = (deals.readReportWindow.mock.calls as unknown[][])[0];
    expect([by, from, to]).toEqual(['end', '2026-09-01', '2026-09-27']);
    expect(projection).toEqual(expect.arrayContaining(['taxAmount', 'taxableAmount', 'totals', 'jobEndDateUtc', 'assignedTechIds']));
  });

  it('batch-reads the Paid jobs by id, retries what DynamoDB left unprocessed, skips deleted ones', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Responses: { BitCRM_Deals: [{ id: 'a' }, { id: 'gone', status: 'deleted' }] },
        UnprocessedKeys: { BitCRM_Deals: { Keys: [{ PK: 'DEAL#b', SK: 'METADATA' }] } },
      })
      .mockResolvedValueOnce({ Responses: { BitCRM_Deals: [{ id: 'b' }] } });
    const repo = new TaxReportRepository({} as never, { client: { send } } as never);
    const rows = await repo.byIds(['a', 'b', 'gone']);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(send).toHaveBeenCalledTimes(2);
    const input = (send.mock.calls[0][0] as { input: { RequestItems: Record<string, { ProjectionExpression: string }> } }).input;
    expect(input.RequestItems.BitCRM_Deals.ProjectionExpression).toContain('#st');
  });
});
