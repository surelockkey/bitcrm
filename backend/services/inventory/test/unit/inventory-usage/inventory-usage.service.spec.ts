import { InventoryUsageService } from 'src/inventory-usage/inventory-usage.service';
import { UsageConflictError } from 'src/inventory-usage/inventory-usage.repository';
import { usageKey } from 'src/inventory-usage/inventory-usage.constants';
import { type UsageJob } from 'src/inventory-usage/inventory-usage.types';
import { createMockInventoryUsageRepository, createMockStoredUsageRow } from '../mocks';

const storedUsageRow = createMockStoredUsageRow;
const AT = '2026-09-08T10:00:00.000Z';

/**
 * Проєкція пишеться в тому ж запиті, що й рух складу: STOCK_USED додає
 * одиниці (створює рядок зі знімками, якщо його нема), STOCK_RESTORED
 * віднімає. Збій проєкції — попередження й метрика, ніколи не збій списання.
 */
describe('InventoryUsageService', () => {
  let repository: ReturnType<typeof createMockInventoryUsageRepository>;
  let service: InventoryUsageService;

  const job: UsageJob = {
    dealNumber: 'K4T9ZW',
    scheduledDate: '2026-09-10',
    clientName: 'Kristie Spegal',
    contactId: 'contact-1',
    techIds: ['tech-1'],
    techNames: ['Dave Tech'],
  };
  const product = {
    name: 'Steel Ball Bearing',
    sku: 'SB-1',
    number: 17,
    category: 'Locks',
    brandId: 'brand-1',
    priceClient: 25,
    costCompany: 10,
  };
  const item = { productId: 'prod-1', productName: 'Steel ball (body)', quantity: 2, product };

  beforeEach(() => {
    repository = createMockInventoryUsageRepository();
    service = new InventoryUsageService(repository as any);
  });

  describe('recordUse — first use of an item on a job', () => {
    it('creates the row under the job date with the job, item and price snapshots, and its pointer', async () => {
      await service.recordUse({ dealId: 'deal-1', containerId: 'c-1', items: [item], job, at: AT });

      expect(repository.getPointer).toHaveBeenCalledWith('deal-1', 'prod-1');
      expect(repository.create).toHaveBeenCalledWith(
        {
          ...usageKey('2026-09-10', 'deal-1', 'prod-1'),
          dealId: 'deal-1',
          productId: 'prod-1',
          jobDate: '2026-09-10',
          dealNumber: 'K4T9ZW',
          clientName: 'Kristie Spegal',
          contactId: 'contact-1',
          techIds: ['tech-1'],
          techNames: ['Dave Tech'],
          productName: 'Steel Ball Bearing',
          sku: 'SB-1',
          number: 17,
          category: 'Locks',
          brandId: 'brand-1',
          qty: 2,
          unitPrice: 25,
          unitCost: 10,
          containerIds: ['c-1'],
          firstUsedAt: AT,
          lastUsedAt: AT,
          source: 'bitcrm',
        },
        undefined,
      );
    });

    it("values the units at the job line's price and cost when deal-service sends them", async () => {
      await service.recordUse({
        dealId: 'deal-1',
        containerId: 'c-1',
        items: [{ ...item, unitPrice: 95.89, unitCost: 12.5 }],
        job,
        at: AT,
      });

      expect(repository.create.mock.calls[0][0]).toMatchObject({ unitPrice: 95.89, unitCost: 12.5 });
    });

    it('files a job with no date under the day of its first use, flagged', async () => {
      await service.recordUse({
        dealId: 'deal-1',
        containerId: 'c-1',
        items: [item],
        job: { ...job, scheduledDate: undefined },
        at: AT,
      });

      expect(repository.create.mock.calls[0][0]).toMatchObject({
        ...usageKey('2026-09-08', 'deal-1', 'prod-1'),
        jobDate: '2026-09-08',
        jobDateMissing: true,
      });
    });

    it('still records a use from a caller that sends no job (older deal-service)', async () => {
      await service.recordUse({ dealId: 'deal-1', containerId: 'c-1', items: [item], at: AT });

      const row = repository.create.mock.calls[0][0];
      expect(row).toMatchObject({ jobDate: '2026-09-08', jobDateMissing: true, techIds: [] });
      expect(row).not.toHaveProperty('dealNumber');
    });

    it('keeps the name the stock move carried for an item this service does not hold', async () => {
      await service.recordUse({
        dealId: 'deal-1',
        containerId: 'c-1',
        items: [{ productId: 'prod-x', productName: 'Mystery part', quantity: 1, product: null }],
        job,
        at: AT,
      });

      const row = repository.create.mock.calls[0][0];
      expect(row.productName).toBe('Mystery part');
      expect(row).not.toHaveProperty('unitPrice');
      expect(row).not.toHaveProperty('category');
    });

    it('recreates a row whose pointer names one that no longer exists', async () => {
      const gone = { PK: 'USAGE#2026-01', SK: 'gone' };
      repository.getPointer.mockResolvedValue(gone);

      await service.recordUse({ dealId: 'deal-1', containerId: 'c-1', items: [item], job, at: AT });

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ qty: 2 }), gone);
    });
  });

  describe('recordUse — the job already has a row for the item', () => {
    const existing = storedUsageRow({ qty: 2 });

    beforeEach(() => {
      repository.getPointer.mockResolvedValue({ PK: existing.PK, SK: existing.SK });
      repository.getRow.mockResolvedValue(existing);
    });

    it('adds the units and the container to it, refreshing the item and its prices', async () => {
      await service.recordUse({
        dealId: 'deal-1',
        containerId: 'c-2',
        items: [{ ...item, quantity: 3 }],
        job: { ...job, clientName: 'Kristie Spegal', techNames: ['Dave Tech'] },
        at: '2026-09-12T10:00:00.000Z',
      });

      expect(repository.replace).not.toHaveBeenCalled();
      expect(repository.addUse).toHaveBeenCalledWith(
        { PK: existing.PK, SK: existing.SK },
        {
          qty: 3,
          containerId: 'c-2',
          at: '2026-09-12T10:00:00.000Z',
          productName: 'Steel Ball Bearing',
          sku: 'SB-1',
          number: 17,
          category: 'Locks',
          brandId: 'brand-1',
          unitPrice: 25,
          unitCost: 10,
        },
      );
    });

    it('first moves the row when the job was rescheduled, then adds to it where it now lives', async () => {
      await service.recordUse({
        dealId: 'deal-1',
        containerId: 'c-1',
        items: [item],
        job: { ...job, scheduledDate: '2026-10-02' },
        at: AT,
      });

      const moved = { ...existing, ...usageKey('2026-10-02', 'deal-1', 'prod-1'), jobDate: '2026-10-02' };
      expect(repository.replace).toHaveBeenCalledWith(existing, expect.objectContaining(moved));
      expect(repository.addUse).toHaveBeenCalledWith(
        usageKey('2026-10-02', 'deal-1', 'prod-1'),
        expect.objectContaining({ qty: 2 }),
      );
    });

    it('reads again and retries when it lost a race with a move', async () => {
      repository.addUse.mockRejectedValueOnce(new UsageConflictError());

      await service.recordUse({ dealId: 'deal-1', containerId: 'c-1', items: [item], job, at: AT });

      expect(repository.getPointer).toHaveBeenCalledTimes(2);
      expect(repository.addUse).toHaveBeenCalledTimes(2);
    });
  });

  describe('recordRestore', () => {
    const existing = storedUsageRow({ qty: 3 });

    it('takes the units off the row the pointer names', async () => {
      repository.getPointer.mockResolvedValue({ PK: existing.PK, SK: existing.SK });
      repository.getRow.mockResolvedValue(existing);

      await service.recordRestore({
        dealId: 'deal-1',
        items: [{ productId: 'prod-1', quantity: 2 }],
        job,
        at: AT,
      });

      expect(repository.addRestore).toHaveBeenCalledWith({ PK: existing.PK, SK: existing.SK }, 2, AT);
      expect(repository.create).not.toHaveBeenCalled();
    });

    // Використання до появи проєкції: від'ємний рядок сховав би наступне
    // списання (−2 + 2 = 0). Історію відновлює backfill:usage-from-log.
    it('writes nothing for an item the projection never saw used', async () => {
      await service.recordRestore({ dealId: 'deal-1', items: [{ productId: 'prod-1', quantity: 2 }], at: AT });

      expect(repository.addRestore).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('never fails the stock move', () => {
    it('swallows a failed write, warning and counting it', async () => {
      const inc = jest.fn();
      const metrics = { createCounter: jest.fn(() => ({ inc })) };
      service = new InventoryUsageService(repository as any, metrics as any);
      repository.create.mockRejectedValue(new Error('dynamo down'));

      await expect(
        service.recordUse({ dealId: 'deal-1', containerId: 'c-1', items: [item, { ...item, productId: 'prod-2' }], job, at: AT }),
      ).resolves.toBeUndefined();
      await expect(
        service.recordRestore({ dealId: 'deal-1', items: [{ productId: 'prod-1', quantity: 1 }], at: AT }),
      ).resolves.toBeUndefined();

      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(inc).toHaveBeenCalledWith({ op: 'use' });
      expect(inc).toHaveBeenCalledTimes(2);
    });

    it('gives up after a few lost races rather than loop', async () => {
      repository.getPointer.mockResolvedValue({ PK: 'USAGE#2026-09', SK: 'k' });
      repository.getRow.mockResolvedValue(storedUsageRow());
      repository.addUse.mockRejectedValue(new UsageConflictError());

      await expect(
        service.recordUse({ dealId: 'deal-1', containerId: 'c-1', items: [item], job, at: AT }),
      ).resolves.toBeUndefined();
      expect(repository.addUse).toHaveBeenCalledTimes(3);
    });
  });

  /**
   * PUT /usage/internal/deals/:dealId/job: роботу перенесли (або змінили
   * клієнта / техніків) — рядки переїжджають у новий місяць / ключ через
   * вказівники. Ідемпотентно: повтор нічого не пише.
   */
  describe('rekeyDeal', () => {
    const rowA = storedUsageRow({ productId: 'prod-1', ...usageKey('2026-09-10', 'deal-1', 'prod-1') });
    const rowB = storedUsageRow({ productId: 'prod-2', ...usageKey('2026-09-10', 'deal-1', 'prod-2') });

    beforeEach(() => {
      repository.listPointers.mockResolvedValue([
        { productId: 'prod-1', PK: rowA.PK, SK: rowA.SK },
        { productId: 'prod-2', PK: rowB.PK, SK: rowB.SK },
      ]);
      repository.getRow.mockImplementation(async (key: { SK: string }) =>
        key.SK === rowA.SK ? rowA : key.SK === rowB.SK ? rowB : null,
      );
    });

    it('moves every row of the job to the new date', async () => {
      const result = await service.rekeyDeal('deal-1', { ...job, scheduledDate: '2026-10-02' });

      expect(result).toEqual({ rows: 2, moved: 2, updated: 0 });
      expect(repository.replace).toHaveBeenCalledWith(
        rowA,
        expect.objectContaining({ ...usageKey('2026-10-02', 'deal-1', 'prod-1'), jobDate: '2026-10-02' }),
      );
      expect(repository.replace).toHaveBeenCalledWith(
        rowB,
        expect.objectContaining({ ...usageKey('2026-10-02', 'deal-1', 'prod-2'), jobDate: '2026-10-02' }),
      );
    });

    it('rewrites in place when only the client or the technicians changed', async () => {
      const result = await service.rekeyDeal('deal-1', {
        ...job,
        clientName: 'Maite Carpenter',
        techIds: ['tech-2', 'tech-3'],
        techNames: ['Yet Tech', 'Eli Tech'],
      });

      expect(result).toEqual({ rows: 2, moved: 0, updated: 2 });
      expect(repository.replace).toHaveBeenCalledWith(
        rowA,
        expect.objectContaining({
          PK: rowA.PK,
          SK: rowA.SK,
          clientName: 'Maite Carpenter',
          techIds: ['tech-2', 'tech-3'],
          techNames: ['Yet Tech', 'Eli Tech'],
        }),
      );
    });

    it('writes nothing when the rows already say what the job says', async () => {
      expect(await service.rekeyDeal('deal-1', job)).toEqual({ rows: 2, moved: 0, updated: 0 });
      expect(repository.replace).not.toHaveBeenCalled();
    });

    it('drops the old technician names rather than pair them with new ids', async () => {
      await service.rekeyDeal('deal-1', { ...job, techIds: ['tech-9'], techNames: undefined });

      const next = repository.replace.mock.calls[0][1];
      expect(next.techIds).toEqual(['tech-9']);
      expect(next.techNames).toBeUndefined();
    });

    it('files a job whose date was cleared under the day of its first use, flagged', async () => {
      await service.rekeyDeal('deal-1', { ...job, scheduledDate: undefined });

      expect(repository.replace).toHaveBeenCalledWith(
        rowA,
        expect.objectContaining({ ...usageKey('2026-09-08', 'deal-1', 'prod-1'), jobDate: '2026-09-08', jobDateMissing: true }),
      );
    });

    it('re-reads and retries a row that changed while it was being moved', async () => {
      repository.listPointers.mockResolvedValue([{ productId: 'prod-1', PK: rowA.PK, SK: rowA.SK }]);
      repository.replace.mockRejectedValueOnce(new UsageConflictError());
      repository.getPointer.mockResolvedValue({ PK: rowA.PK, SK: rowA.SK });

      const result = await service.rekeyDeal('deal-1', { ...job, scheduledDate: '2026-10-02' });

      expect(repository.replace).toHaveBeenCalledTimes(2);
      expect(result.moved).toBe(1);
    });

    it('skips a pointer whose row is gone', async () => {
      repository.getRow.mockResolvedValue(null);

      expect(await service.rekeyDeal('deal-1', { ...job, scheduledDate: '2026-10-02' })).toEqual({
        rows: 2,
        moved: 0,
        updated: 0,
      });
    });
  });
});
