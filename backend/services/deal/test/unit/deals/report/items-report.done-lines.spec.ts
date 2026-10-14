/**
 * The Items and services report off the Done-lines index answers EXACTLY what
 * it answered job by job: the same table, read both ways — before the
 * backfill (one Query per job) and after it (one Query per month) — through
 * the real repositories and the real service.
 */
import { DealStatus, JobSuperStatus, type ResolvedPermissions } from '@bitcrm/types';
import { DealsRepository, statusScheduleKeys } from 'src/deals/deals.repository';
import { ItemsReportRepository } from 'src/deals/report/items-report.repository';
import { ItemsReportService } from 'src/deals/report/items-report.service';
import type { ItemsReportQueryDto } from 'src/deals/report/items-report.query';
import type { ReportCaller } from 'src/deals/report/jobs-report.service';
import { reconcileDoneLines } from 'src/scripts/backfill-done-lines-index';
import { createMockJwtUser } from '../../mocks';
import { fakeDealsTable } from './fake-deals-table';

const TABLE = 'BitCRM_Deals';

function job(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    PK: `DEAL#${id}`,
    SK: 'METADATA',
    id,
    status: DealStatus.ACTIVE,
    dealNumber: id.toUpperCase(),
    jobSerial: 100,
    contactId: `c-${id}`,
    jobTypeId: 'jt1',
    createdAt: '2026-09-10T15:00:00.000Z',
    scheduledDate: '2026-09-12',
    scheduledTimeSlot: '10:00-11:00',
    superStatus: JobSuperStatus.DONE,
    assignedTechIds: ['tech-1'],
    ...over,
  };
  return { ...row, ...statusScheduleKeys(row as never) };
}

let n = 0;
function line(dealId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  n += 1;
  return {
    PK: `DEAL#${dealId}`,
    SK: `PRODUCT#l${String(n).padStart(3, '0')}`,
    lineId: `l${n}`,
    type: 'product',
    quantity: 1,
    priceClient: 100,
    costCompany: 40,
    fulfillment: 'imported',
    addedBy: 'workiz-import',
    ...over,
  };
}

const SEED = [
  job('a'),
  line('a', { productId: 'p-lock', itemId: '10455', itemName: 'Lock Install', type: 'service', quantity: 2, priceClient: 75, costCompany: 0, soldBy: 'u-sam' }),
  line('a', { productId: 'p-key', itemId: '6017', itemName: 'Ford key', priceClient: 120, costCompany: 19.35, soldBy: 'u-sam' }),
  line('a', { productId: 'p-fee', itemId: '10968', type: 'SERVICE_FEE_TYPE', priceClient: 7.31, costCompany: 0 }),
  job('b', { scheduledDate: '2026-09-15', assignedTechIds: ['me'], clientName: { firstName: 'Ronda', lastName: 'Cook' } }),
  line('b', { productId: 'p-key', itemId: '6017', itemName: 'Ford key', quantity: 3, priceClient: 110, costCompany: 19.35, soldBy: 'u-kim' }),
  // The first and last days of the period, and the month edge.
  job('c', { scheduledDate: '2026-09-01', scheduledTimeSlot: undefined, allDay: true }),
  line('c', { productId: 'p-lock', itemId: '10455', itemName: 'Lock Install', type: 'service', quantity: 1.5, priceClient: 80, costCompany: 0 }),
  job('c2', { scheduledDate: '2026-09-30' }),
  line('c2', { productId: 'p-cyl', itemId: '7001', itemName: 'Cylinder', quantity: 4, priceClient: 30, costCompany: 8, addedBy: 'u-kim', fulfillment: 'sourced' }),
  // Inside the margin the index reads, outside the period: never counted.
  job('d', { scheduledDate: '2026-10-01' }),
  line('d', { productId: 'p-key', itemId: '6017', quantity: 100 }),
  job('d0', { scheduledDate: '2026-08-31' }),
  line('d0', { productId: 'p-key', itemId: '6017', quantity: 100 }),
  // Undated, created inside the period: dated by its creation.
  job('u', { scheduledDate: undefined, scheduledTimeSlot: undefined, createdAt: '2026-09-20T16:00:00.000Z' }),
  line('u', { productId: 'p-cyl', itemId: '7001', itemName: 'Cylinder', quantity: 2, priceClient: 30, costCompany: 8 }),
  // Neither Done, nor live, nor real: their lines never count.
  job('e', { superStatus: JobSuperStatus.CANCELED }),
  line('e', { productId: 'p-key', itemId: '6017', quantity: 100 }),
  job('f', { status: DealStatus.DELETED }),
  line('f', { productId: 'p-key', itemId: '6017', quantity: 100 }),
  job('s', { isStub: true }),
  line('s', { productId: 'p-key', itemId: '6017', quantity: 100 }),
  // A Done job with no lines, and lines whose job row is gone.
  job('g'),
  line('ghost', { productId: 'p-key', itemId: '6017', quantity: 100 }),
];

const perms = (dealsScope = 'all'): ResolvedPermissions =>
  ({
    roleId: 'r',
    roleName: 'Dispatcher',
    isSystemRole: false,
    permissions: { reports: { view: true }, financials: { view: true } },
    dataScope: { deals: dealsScope },
  }) as unknown as ResolvedPermissions;

function http() {
  return {
    getProductsForReport: jest.fn(async (ids: string[]) =>
      new Map(
        ids
          .filter((id) => id !== 'p-lock')
          .map((id) => [id, { id, number: id === 'p-cyl' ? 7001 : 6017, name: `${id} (catalog)`, sku: 'SKU', category: 'Keys', type: 'product' }]),
      ),
    ),
    getUserNamesBatch: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: id, lastName: 'Tech' }))),
    getContactNames: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Client', lastName: id }))),
  };
}

async function readAll(dynamoDb: unknown) {
  const service = new ItemsReportService(
    new DealsRepository(dynamoDb as never),
    new ItemsReportRepository(dynamoDb as never),
    http() as never,
  );
  const out: unknown[] = [];
  for (const scope of ['all', 'assigned_only']) {
    const caller: ReportCaller = { user: createMockJwtUser({ id: 'me' }), perms: perms(scope) };
    for (const window of [
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-09-12', to: '2026-09-12' },
      { from: '2026-08-01', to: '2026-10-31' },
    ]) {
      const q = window as ItemsReportQueryDto;
      const page = await service.page(q, caller);
      out.push(page);
      for (const row of page.rows) out.push(await service.jobs({ ...q, item: row.key } as ItemsReportQueryDto, caller));
      out.push((await service.exportCsv(q, caller)).csv);
    }
  }
  return out;
}

describe('Items report — job by job vs the Done-lines index', () => {
  it('answers the same pages, drill-downs and CSVs both ways', async () => {
    const table = fakeDealsTable(SEED);
    const before = await readAll(table.dynamoDb);
    const perJob = table.calls.filter((c) => c.name === 'QueryCommand' && c.input.IndexName === undefined).length;
    expect(perJob).toBeGreaterThan(0);

    const result = await reconcileDoneLines(table.send as never, { table: TABLE, apply: true, log: () => undefined });
    expect(result.readyAt).toBeDefined();

    table.calls.length = 0;
    const after = await readAll(table.dynamoDb);
    expect(after).toEqual(before);
    // No per-job line Query any more: the lines came off the index.
    expect(table.calls.filter((c) => c.name === 'QueryCommand' && c.input.IndexName === undefined)).toHaveLength(0);
    expect(table.calls.some((c) => c.name === 'QueryCommand' && c.input.IndexName === 'EndIndex')).toBe(true);
    // Something real was compared.
    expect((before[0] as { rows: unknown[] }).rows.length).toBeGreaterThan(1);
  });
});
