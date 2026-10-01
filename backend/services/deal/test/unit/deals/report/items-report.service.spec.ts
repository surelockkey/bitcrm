import { BadRequestException } from '@nestjs/common';
import { JobSuperStatus, type ResolvedPermissions } from '@bitcrm/types';
import { ItemsReportService } from 'src/deals/report/items-report.service';
import type { ReportCaller } from 'src/deals/report/jobs-report.service';
import type { ItemsReportQueryDto } from 'src/deals/report/items-report.query';
import { ReportWindowTooLargeError } from 'src/deals/deals.repository';
import { createMockJwtUser } from '../../mocks';

/** A Done job as the window read projects it. */
const deal = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  status: 'active',
  dealNumber: id.toUpperCase(),
  jobSerial: 100,
  contactId: `c-${id}`,
  jobTypeId: 'jt1',
  createdAt: '2026-09-10T15:00:00.000Z',
  scheduledDate: '2026-09-12',
  scheduledTimeSlot: '10:00-11:00',
  superStatus: 'done',
  assignedTechIds: ['tech-1'],
  ...over,
});

const line = (over: Record<string, unknown>): Record<string, unknown> => ({
  SK: `PRODUCT#${Math.random()}`,
  type: 'product',
  quantity: 1,
  priceClient: 100,
  costCompany: 40,
  fulfillment: 'imported',
  addedBy: 'workiz-import',
  ...over,
});

const perms = (grants: Record<string, Record<string, boolean>>, dealsScope = 'all'): ResolvedPermissions =>
  ({ roleId: 'r', roleName: 'Dispatcher', isSystemRole: false, permissions: grants, dataScope: { deals: dealsScope } }) as unknown as ResolvedPermissions;

const FULL = perms({ reports: { view: true }, financials: { view: true } });

describe('ItemsReportService', () => {
  let repository: { readReportWindow: jest.Mock };
  let lines: { linesOf: jest.Mock };
  let http: { getProductsForReport: jest.Mock; getUserNamesBatch: jest.Mock; getContactNames: jest.Mock };
  let service: ItemsReportService;
  const caller = (p: ResolvedPermissions = FULL): ReportCaller => ({ user: createMockJwtUser({ id: 'me' }), perms: p });
  const q = (over: Partial<ItemsReportQueryDto> = {}) => ({ from: '2026-09-01', to: '2026-09-27', ...over }) as ItemsReportQueryDto;

  beforeEach(() => {
    repository = {
      readReportWindow: jest.fn().mockResolvedValue([
        deal('a'),
        deal('b', { scheduledDate: '2026-09-15', assignedTechIds: ['me'], clientName: { firstName: 'Ronda', lastName: 'Cook' }, clientCompanyName: 'ASSLC' }),
        deal('c', { scheduledDate: '2026-09-20' }),
        // Read with a day's margin by the index — outside the window on the Eastern clock.
        deal('d', { scheduledDate: '2026-09-28' }),
        // A status the index would not return for Done — checked again anyway.
        deal('e', { superStatus: 'canceled' }),
      ]),
    };
    lines = {
      linesOf: jest.fn(async (ids: string[]) => {
        const all: Record<string, Record<string, unknown>[]> = {
          a: [
            line({ productId: 'p-lock', itemId: '10455', itemName: 'Lock Install', type: 'service', quantity: 2, priceClient: 75, costCompany: 0, soldBy: 'u-sam' }),
            line({ productId: 'p-key', itemId: '6017', itemName: 'Ford key', quantity: 1, priceClient: 120, costCompany: 19.35, soldBy: 'u-sam' }),
            line({ productId: 'p-fee', itemId: '10968', type: 'SERVICE_FEE_TYPE', priceClient: 7.31, costCompany: 0 }),
          ],
          b: [line({ productId: 'p-key', itemId: '6017', itemName: 'Ford key', quantity: 3, priceClient: 110, costCompany: 19.35, soldBy: 'u-kim' })],
          c: [line({ productId: 'p-lock', itemId: '10455', itemName: 'Lock Install', type: 'service', quantity: 1.5, priceClient: 80, costCompany: 0 })],
          d: [line({ productId: 'p-key', itemId: '6017', quantity: 100 })],
          e: [line({ productId: 'p-key', itemId: '6017', quantity: 100 })],
        };
        return new Map(ids.filter((id) => all[id]).map((id) => [id, all[id]]));
      }),
    };
    http = {
      getProductsForReport: jest.fn(async (ids: string[]) =>
        new Map(
          ids
            .filter((id) => id !== 'p-lock')
            .map((id) => [id, { id, number: 6017, name: 'Ford key (catalog)', sku: 'RK-FD-402', workizSerial: 'RK-FD-402 (SLK-6017)', category: 'Keys & Remotes', type: 'product', externalId: 'workiz:item:6017' }]),
        ),
      ),
      getUserNamesBatch: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: id === 'u-sam' ? 'Sam' : 'Kim', lastName: 'Tech' }))),
      getContactNames: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Client', lastName: id }))),
    };
    service = new ItemsReportService(repository as never, lines as never, http as never);
  });

  it('reads Done jobs off the schedule index, then their lines, then the price book', async () => {
    const page = await service.page(q(), caller());
    const [by, from, to, , opts] = repository.readReportWindow.mock.calls[0];
    expect([by, from, to]).toEqual(['scheduled', '2026-09-01', '2026-09-27']);
    expect(opts).toEqual({ statuses: [JobSuperStatus.DONE] });
    // Only the jobs that count are asked for their lines.
    expect(lines.linesOf.mock.calls[0][0]).toEqual(['a', 'b', 'c']);
    expect(http.getProductsForReport.mock.calls[0][0].sort()).toEqual(['p-key', 'p-lock']);

    expect(page.totals).toEqual({ items: 2, units: 7.5, price: 720, cost: 77.4, profit: 642.6, margin: 89.25 });
    // Workiz's default order: the newest item (highest number) first.
    expect(page.rows.map((r) => r.key)).toEqual(['p-lock', 'p-key']);
    expect(page.rows[1]).toMatchObject({
      number: 6017,
      name: 'Ford key (catalog)',
      model: 'RK-FD-402 (SLK-6017)',
      category: 'Keys & Remotes',
      units: 4,
      price: 450,
      cost: 77.4,
      profit: 372.6,
      jobs: 2,
    });
    // The price book does not know this one: the line's own words print; the fee line is no item.
    expect(page.rows[0]).toMatchObject({ number: 10455, name: 'Lock Install', type: 'service', units: 3.5, price: 270, jobs: 2 });
    expect(page.pagination).toMatchObject({ page: 1, pageSize: 50, total: 2, pages: 1, from: 1, to: 2 });
    expect(page.money).toBe(true);
    expect(page.options).toEqual({
      categories: ['Keys & Remotes'],
      soldBy: [
        { id: 'u-kim', name: 'Kim Tech' },
        { id: 'u-sam', name: 'Sam Tech' },
      ],
    });
  });

  it('filters, searches and sorts in memory — the window is read once a minute', async () => {
    const sold = await service.page(q({ soldBy: 'u-kim' }), caller());
    expect(sold.rows.map((r) => [r.key, r.units])).toEqual([['p-key', 3]]);
    expect(sold.totals.price).toBe(330);
    // The options still offer every seller of the period.
    expect(sold.options.soldBy).toHaveLength(2);

    expect((await service.page(q({ type: 'service' }), caller())).rows.map((r) => r.key)).toEqual(['p-lock']);
    expect((await service.page(q({ category: 'Keys & Remotes' }), caller())).rows.map((r) => r.key)).toEqual(['p-key']);
    expect((await service.page(q({ jobTypeId: 'jt2' }), caller())).rows).toEqual([]);

    const searched = await service.page(q({ q: 'lock' }), caller());
    expect(searched.rows.map((r) => r.key)).toEqual(['p-lock']);
    expect(searched.totals).toMatchObject({ items: 1, units: 3.5, price: 270 });

    expect((await service.page(q({ sort: 'price', dir: 'asc' }), caller())).rows.map((r) => r.key)).toEqual(['p-lock', 'p-key']);
    expect(repository.readReportWindow).toHaveBeenCalledTimes(1);
    expect(lines.linesOf).toHaveBeenCalledTimes(1);
  });

  it('leaves money out without financials.view, and will not sort on it', async () => {
    const page = await service.page(q({ sort: 'price' }), caller(perms({ reports: { view: true } })));
    expect(page.money).toBe(false);
    expect(page.sort.column).toBe('number');
    expect(page.totals).toEqual({ items: 2, units: 7.5 });
    for (const r of page.rows) {
      expect(r.price).toBeUndefined();
      expect(r.cost).toBeUndefined();
      expect(r.profit).toBeUndefined();
    }
  });

  it('assigned_only counts only the jobs the caller is on', async () => {
    const page = await service.page(q(), caller(perms({ reports: { view: true }, financials: { view: true } }, 'assigned_only')));
    expect(page.rows.map((r) => [r.key, r.units, r.jobs])).toEqual([['p-key', 3, 1]]);
  });

  it("an item's jobs: one row per job, newest first, named, with the item's own row", async () => {
    const res = await service.jobs(q({ item: 'p-key' }), caller());
    expect(res.item).toMatchObject({ key: 'p-key', units: 4, jobs: 2 });
    expect(res.rows.map((r) => r.dealId)).toEqual(['b', 'a']);
    expect(res.rows[0]).toMatchObject({
      jobNumber: 'B',
      client: 'Ronda Cook',
      clientCompany: 'ASSLC',
      jobDate: '2026-09-15T10:00',
      units: 3,
      price: 330,
      cost: 58.05,
      profit: 271.95,
      soldBy: [{ id: 'u-kim', name: 'Kim Tech' }],
    });
    expect(res.rows[1].client).toBe('Client c-a');
    // The per-job name is used as is; crm is asked only for the other.
    expect(http.getContactNames).toHaveBeenCalledWith(['c-a']);
    expect(res.pagination.total).toBe(2);
  });

  it("an item's jobs follow the filters too, and need the item", async () => {
    const res = await service.jobs(q({ item: 'p-key', soldBy: 'u-sam' }), caller());
    expect(res.rows.map((r) => r.dealId)).toEqual(['a']);
    await expect(service.jobs(q(), caller())).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.jobs(q({ item: 'nothing' }), caller())).item).toBeNull();
  });

  it("exports Workiz's CSV: Totals first, every row", async () => {
    const { csv, rows } = await service.exportCsv(q(), caller());
    expect(rows).toBe(2);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Item,SKU,Units,Category,Price,Cost,Profit,Jobs,Service Plan');
    expect(lines[1]).toBe('Totals,,7.50,,720.00,77.40,642.60,,');
    expect(lines[2]).toBe('Lock Install,,3.50,,270.00,0.00,270.00,2,No');
    expect(lines[3]).toBe('Ford key (catalog),RK-FD-402 (SLK-6017),4.00,Keys & Remotes,450.00,77.40,372.60,2,No');
  });

  it('a window too large is a 400 that says so, and is not kept', async () => {
    repository.readReportWindow.mockRejectedValueOnce(new ReportWindowTooLargeError(150_000));
    await expect(service.page(q(), caller())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.page(q(), caller())).resolves.toBeDefined();
  });

  it('a price book that cannot answer costs the names, never the report', async () => {
    http.getProductsForReport.mockResolvedValue(new Map());
    const page = await service.page(q(), caller());
    expect(page.rows.find((r) => r.key === 'p-key')).toMatchObject({ name: 'Ford key', number: 6017 });
    expect(page.options.categories).toEqual([]);
  });
});
