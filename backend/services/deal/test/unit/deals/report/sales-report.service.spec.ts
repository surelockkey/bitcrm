/**
 * The Sales report end to end without DynamoDB: `SalesReportService` over a
 * real `DealsRepository` whose table is the report indexes in memory
 * (`scripts/jobs-report-in-memory.ts`), names through a real
 * `JobsReportService` with stubbed catalogs and crm.
 */
import { BadRequestException } from '@nestjs/common';
import { SALES_REPORT_DEFAULT_SETTINGS, type ResolvedPermissions, type SalesReportSettings } from '@bitcrm/types';
import { DealsRepository } from 'src/deals/deals.repository';
import { JobsReportService } from 'src/deals/report/jobs-report.service';
import { SalesReportService } from 'src/deals/report/sales-report.service';
import type { SalesReportQueryDto } from 'src/deals/report/sales-report.query';
import { InMemoryReportIndexes } from 'src/scripts/jobs-report-in-memory';

const row = (id: string, over: Record<string, unknown>): Record<string, unknown> => ({
  PK: `DEAL#${id}`,
  SK: 'METADATA',
  id,
  status: 'active',
  dealNumber: id.toUpperCase(),
  contactId: `c-${id}`,
  superStatus: 'done',
  createdAt: '2026-09-02T12:00:00.000Z',
  scheduledDate: '2026-09-02',
  scheduledEndDate: '2026-09-02',
  scheduledTimeSlot: '09:00-10:00',
  assignedTechIds: ['tech-1'],
  ...over,
});
const money = (total: number, paid: number, over: Record<string, unknown> = {}) => ({
  totals: { subtotal: total, tax: 0, total, cost: 0, amountPaid: paid, source: 'workiz' },
  companyParts: 0,
  parts: 0,
  ...over,
});

const ROWS = [
  row('a', { jobSerial: 10, ...money(100, 100) }),
  row('b', { jobSerial: 11, scheduledDate: '2026-09-03', scheduledEndDate: '2026-09-03', ...money(250, 0, { companyParts: 50 }) }),
  row('c', { jobSerial: 12, superStatus: 'pending', assignedTechIds: ['tech-2'], ...money(40, 10) }),
  // Not sales: canceled, and a Done job never priced.
  row('canceled', { jobSerial: 13, superStatus: 'canceled', ...money(999, 0) }),
  row('zero', { jobSerial: 14, ...money(0, 0) }),
  // Out of the period.
  row('october', { jobSerial: 15, scheduledDate: '2026-10-01', scheduledEndDate: '2026-10-01', ...money(500, 0) }),
];

const admin = { roleName: 'Super Admin', isSystemRole: true, permissions: {}, dataScope: {} } as unknown as ResolvedPermissions;
const tech = {
  roleName: 'Technician',
  isSystemRole: false,
  permissions: { reports: { view: true } },
  dataScope: { deals: 'assigned_only' },
} as unknown as ResolvedPermissions;

describe('SalesReportService', () => {
  let indexes: InMemoryReportIndexes;
  let service: SalesReportService;
  let settings: SalesReportSettings;
  const partitions: string[] = [];
  const put = jest.fn();

  beforeEach(() => {
    partitions.length = 0;
    put.mockReset();
    settings = { ...SALES_REPORT_DEFAULT_SETTINGS, columns: [...SALES_REPORT_DEFAULT_SETTINGS.columns] };
    indexes = new InMemoryReportIndexes(ROWS);
    const db = indexes.dynamoDb;
    const spy = {
      client: {
        send: async (cmd: { input: { ExpressionAttributeValues?: Record<string, unknown> } }) => {
          partitions.push(String(cmd.input.ExpressionAttributeValues?.[':pk']));
          return db.client.send(cmd);
        },
      },
    };
    const repository = new DealsRepository(spy as never);
    const catalog = { list: async () => [] };
    const c = catalog as never;
    const crm = {
      getUserNamesBatch: async (ids: string[]) => ids.map((id) => ({ id, firstName: id.toUpperCase() })),
      getContactNames: async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Client', lastName: id })),
      getContactsAsCaller: async () => [],
    };
    const jobs = new JobsReportService(repository, {} as never, crm as never, c, c, c, c, c, c);
    service = new SalesReportService(repository, { get: async () => settings, put } as never, jobs);
  });

  const page = (q: Record<string, unknown>, perms = admin, id = 'me') =>
    service.page({ from: '2026-09-01', to: '2026-09-30', ...q } as SalesReportQueryDto, { user: { id } as never, perms });

  it('lists the period\'s sales, newest Job ID first, with Workiz\'s Total and a day chart', async () => {
    const res = await page({});
    expect(res.rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(res.window).toEqual({ by: 'scheduled', from: '2026-09-01', to: '2026-09-30' });
    expect(res.totals).toMatchObject({ jobs: 3, total: 390, paid: 110, due: 280, itemCost: 50, profit: 340 });
    expect(res.chart).toHaveLength(30);
    expect(res.chart[1]).toEqual({ day: '2026-09-02', sales: 140, profit: 140 });
    expect(res.chart[2]).toEqual({ day: '2026-09-03', sales: 250, profit: 200 });
    expect(res.rows[0].client).toBe('Client c-c');
  });

  it('reads only the five status partitions a sale can be in — never Canceled', async () => {
    await page({ by: 'scheduled' });
    expect(partitions.length).toBeGreaterThan(0);
    expect(partitions.some((p) => p.includes('canceled'))).toBe(false);
    expect(new Set(partitions.filter((p) => p.startsWith('STATUS#')))).toEqual(
      new Set(['STATUS#submitted', 'STATUS#in_progress', 'STATUS#done', 'STATUS#pending', 'STATUS#done_pending_approval']),
    );
  });

  it('by Job end date reads the EndIndex (not split by status) and still leaves Canceled out', async () => {
    const res = await page({ by: 'end' });
    expect(partitions).toEqual(['END#2026-09']);
    expect(res.rows.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('filters: payment status and team', async () => {
    expect((await page({ paymentStatus: 'due' })).rows.map((r) => r.id)).toEqual(['b']);
    expect((await page({ paymentStatus: 'partly_paid' })).rows.map((r) => r.id)).toEqual(['c']);
    expect((await page({ techId: 'tech-2' })).totals).toMatchObject({ jobs: 1, total: 40 });
  });

  it('the search narrows the rows and the Total, not the chart (as Workiz\'s)', async () => {
    const res = await page({ q: 'Client c-b' });
    expect(res.rows.map((r) => r.id)).toEqual(['b']);
    expect(res.totals).toMatchObject({ jobs: 1, total: 250 });
    expect(res.chart.reduce((s, d) => s + d.sales, 0)).toBe(390);
  });

  it('sorts on any column and pages on the server', async () => {
    const res = await page({ sort: 'total', dir: 'desc', pageSize: '2', page: '2' });
    expect(res.rows.map((r) => r.id)).toEqual(['c']);
    expect(res.pagination).toMatchObject({ page: 2, pageSize: 2, total: 3, pages: 2, from: 3, to: 3 });
    expect(res.totals.jobs).toBe(3);
  });

  it('without financials.view: no amount, no chart, and no sorting by an amount; assigned_only sees its own jobs', async () => {
    const res = await page({ sort: 'total' }, tech, 'tech-2');
    expect(res.money).toBe(false);
    expect(res.rows.map((r) => r.id)).toEqual(['c']);
    expect(res.rows[0]).not.toHaveProperty('total');
    expect(res.totals).toEqual({ jobs: 1 });
    expect(res.chart).toEqual([]);
    expect(res.sort.column).toBe('jobNumber');
  });

  it('exports the visible columns, the Total row first', async () => {
    let csv = '';
    const out = await service.exportCsv(
      { from: '2026-09-01', to: '2026-09-30', columns: 'jobNumber,client,total,due' } as SalesReportQueryDto,
      { user: { id: 'me' } as never, perms: admin },
      { write: (s: string) => void (csv += s) },
    );
    expect(out.rows).toBe(3);
    expect(csv.split('\r\n')).toEqual(['Job ID,Client,Total,Due', 'Total:,,390.00,280.00', 'C,Client c-c,40.00,30.00', 'B,Client c-b,250.00,250.00', 'A,Client c-a,100.00,0.00', '']);
  });

  it('drops money columns from the file without financials.view', async () => {
    let csv = '';
    await service.exportCsv(
      { from: '2026-09-01', to: '2026-09-30', columns: 'jobNumber,total' } as SalesReportQueryDto,
      { user: { id: 'tech-2' } as never, perms: tech },
      { write: (s: string) => void (csv += s) },
    );
    expect(csv.split('\r\n')[0]).toBe('Job ID');
  });

  it('settings: at least one known column, stored in the report order, a known "By:"', async () => {
    await expect(service.saveSettings({ columns: [] }, { id: 'u' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveSettings({ columns: ['nope'] }, { id: 'u' } as never)).rejects.toThrow(/Unknown columns/);
    await expect(service.saveSettings({ by: 'firstPayment' }, { id: 'u' } as never)).rejects.toThrow(/by must be one of/);
    await expect(service.saveSettings({ columns: ['profit', 'jobNumber'], by: 'end' }, { id: 'u' } as never)).resolves.toEqual({
      columns: ['jobNumber', 'profit'],
      by: 'end',
    });
    expect(put).toHaveBeenCalledWith({ columns: ['jobNumber', 'profit'], by: 'end' }, 'u');
  });

  it('opens on the account\'s "By:" when none is asked for', async () => {
    settings.by = 'created';
    expect((await page({})).window.by).toBe('created');
  });
});
