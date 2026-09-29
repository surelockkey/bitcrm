import { BadRequestException } from '@nestjs/common';
import { InventoryLogAction } from '@bitcrm/types';
import { InventoryLogService } from 'src/inventory-log/inventory-log.service';
import { createMockInventoryLogEntry, createMockInventoryLogRepository } from '../mocks';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));

/**
 * Журнал читається по місячних партиціях: сервіс іде від місяця `to` вниз до
 * місяця `from` і добирає сторінку між ними, як scanPage добирає її між
 * читаннями. Курсор пам'ятає місяць і ключ, з якого продовжити.
 */
describe('InventoryLogService', () => {
  let repository: ReturnType<typeof createMockInventoryLogRepository>;
  let service: InventoryLogService;

  const entry = (id: string) => createMockInventoryLogEntry({ id });

  beforeEach(() => {
    repository = createMockInventoryLogRepository();
    service = new InventoryLogService(repository as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('record', () => {
    const input = {
      action: InventoryLogAction.STOCK_RECEIVED,
      productId: 'prod-1',
      productName: 'Deadbolt',
      quantity: 2,
      userId: 'admin-1',
      userName: 'admin@test.com',
    };

    it('assigns an id and createdAt and writes the row', async () => {
      await service.record(input);

      expect(repository.create).toHaveBeenCalledWith({
        ...input,
        id: expect.any(String),
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it('never throws — a failed write is logged and dropped', async () => {
      repository.create.mockRejectedValue(new Error('dynamo down'));

      await expect(service.record(input)).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    const window = { from: '2026-08-01T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' };

    it('defaults the window to the current UTC month up to now', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00.000Z'));

      await service.list({});

      expect(repository.queryMonth).toHaveBeenCalledTimes(1);
      expect(repository.queryMonth).toHaveBeenCalledWith(
        '2026-09',
        { from: '2026-09-01T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' },
        {},
        20,
        undefined,
      );
    });

    it('normalises date-only bounds to ISO timestamps', async () => {
      await service.list({ from: '2026-08-15', to: '2026-09-10' });

      expect(repository.queryMonth).toHaveBeenCalledWith(
        '2026-09',
        { from: '2026-08-15T00:00:00.000Z', to: '2026-09-10T00:00:00.000Z' },
        {},
        20,
        undefined,
      );
    });

    it('rejects a window whose from is after to', async () => {
      await expect(
        service.list({ from: '2026-10-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.queryMonth).not.toHaveBeenCalled();
    });

    it('walks from the month of `to` down to the month of `from`, filling the page across them', async () => {
      repository.queryMonth.mockImplementation(async (month: string) =>
        month === '2026-09'
          ? { items: [entry('sep-1'), entry('sep-2')], lastKey: undefined }
          : { items: [entry('aug-1')], lastKey: undefined },
      );

      const result = await service.list({ ...window, limit: 4 });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'sep-2', 'aug-1']);
      expect(result.nextCursor).toBeUndefined();
      expect(repository.queryMonth.mock.calls.map((c) => [c[0], c[3], c[4]])).toEqual([
        ['2026-09', 4, undefined],
        ['2026-08', 2, undefined],
      ]);
    });

    it('hands back a cursor inside the month that filled the page', async () => {
      repository.queryMonth.mockImplementation(async (month: string) =>
        month === '2026-09'
          ? { items: [entry('sep-1')], lastKey: undefined }
          : { items: [entry('aug-1')], lastKey: { PK: 'INVLOG#2026-08', SK: 'k' } },
      );

      const result = await service.list({ ...window, limit: 2 });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'aug-1']);
      expect(decode(result.nextCursor!)).toEqual({
        month: '2026-08',
        lastKey: { PK: 'INVLOG#2026-08', SK: 'k' },
      });
    });

    it('resumes in the month the cursor names, from its key', async () => {
      repository.queryMonth.mockResolvedValue({ items: [entry('aug-2')], lastKey: undefined });
      const cursor = encode({ month: '2026-08', lastKey: { PK: 'INVLOG#2026-08', SK: 'k' } });

      const result = await service.list({ ...window, limit: 5, cursor });

      expect(result.items.map((i) => i.id)).toEqual(['aug-2']);
      expect(repository.queryMonth).toHaveBeenCalledTimes(1);
      expect(repository.queryMonth).toHaveBeenCalledWith('2026-08', window, {}, 5, {
        PK: 'INVLOG#2026-08',
        SK: 'k',
      });
    });

    it('points the cursor at the next month when a month ends exactly on the page boundary', async () => {
      repository.queryMonth.mockResolvedValue({ items: [entry('sep-1'), entry('sep-2')], lastKey: undefined });

      const result = await service.list({ ...window, limit: 2 });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'sep-2']);
      expect(decode(result.nextCursor!)).toEqual({ month: '2026-08' });
      expect(repository.queryMonth).toHaveBeenCalledTimes(1);
    });

    it('ends without a cursor when the last month ends on the page boundary', async () => {
      repository.queryMonth.mockResolvedValue({ items: [entry('aug-1'), entry('aug-2')], lastKey: undefined });

      const result = await service.list({ from: window.from, to: '2026-08-31T00:00:00.000Z', limit: 2 });

      expect(result.nextCursor).toBeUndefined();
    });

    it('keeps reading the same month while a filtered read comes back short', async () => {
      repository.queryMonth
        .mockResolvedValueOnce({ items: [entry('sep-1')], lastKey: { PK: 'INVLOG#2026-09', SK: 'a' } })
        .mockResolvedValueOnce({ items: [entry('sep-2')], lastKey: undefined })
        .mockResolvedValueOnce({ items: [], lastKey: undefined });

      const result = await service.list({ ...window, limit: 3, userId: 'user-1' });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'sep-2']);
      expect(repository.queryMonth.mock.calls.map((c) => [c[0], c[3], c[4]])).toEqual([
        ['2026-09', 3, undefined],
        ['2026-09', 2, { PK: 'INVLOG#2026-09', SK: 'a' }],
        ['2026-08', 1, undefined],
      ]);
    });

    it('stops after its read budget and hands the position back rather than walk on', async () => {
      repository.queryMonth.mockResolvedValue({ items: [], lastKey: { PK: 'INVLOG#2026-09', SK: 'z' } });

      const result = await service.list({ ...window, limit: 20, search: 'nothing matches' });

      expect(result.items).toEqual([]);
      expect(decode(result.nextCursor!)).toEqual({
        month: '2026-09',
        lastKey: { PK: 'INVLOG#2026-09', SK: 'z' },
      });
      expect(repository.queryMonth.mock.calls.length).toBeLessThanOrEqual(20);
    });

    it('passes userId, action and search to the repository', async () => {
      await service.list({
        ...window,
        userId: 'user-1',
        action: InventoryLogAction.STOCK_USED,
        search: 'Deadbolt',
      });

      expect(repository.queryMonth).toHaveBeenCalledWith(
        '2026-09',
        window,
        { userId: 'user-1', action: InventoryLogAction.STOCK_USED, search: 'Deadbolt' },
        20,
        undefined,
      );
    });

    it('reads one product off the per-item index instead of walking months', async () => {
      repository.queryProduct.mockResolvedValue({
        items: [entry('p-1')],
        lastKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' },
      });

      const result = await service.list({ ...window, productId: 'prod-1', limit: 1, userId: 'user-1' });

      expect(result.items.map((i) => i.id)).toEqual(['p-1']);
      expect(decode(result.nextCursor!)).toEqual({ lastKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' } });
      expect(repository.queryProduct).toHaveBeenCalledWith('prod-1', window, { userId: 'user-1' }, 1, undefined);
      expect(repository.queryMonth).not.toHaveBeenCalled();
    });

    it('continues a per-item read from the cursor key', async () => {
      repository.queryProduct.mockResolvedValue({ items: [], lastKey: undefined });
      const cursor = encode({ lastKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' } });

      const result = await service.list({ ...window, productId: 'prod-1', cursor });

      expect(result.nextCursor).toBeUndefined();
      expect(repository.queryProduct).toHaveBeenCalledWith('prod-1', window, {}, 20, {
        PK: 'x',
        SK: 'y',
        GSI4PK: 'p',
        GSI4SK: 'q',
      });
    });
  });

  describe('count', () => {
    const window = { from: '2026-08-01T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' };

    it('sums the months of the window', async () => {
      repository.countMonth.mockImplementation(async (month: string) =>
        month === '2026-09' ? { total: 4, atLeast: false } : { total: 3, atLeast: false },
      );

      expect(await service.count({ ...window, userId: 'user-1' })).toEqual({ total: 7, atLeast: false });
      expect(repository.countMonth.mock.calls.map((c) => c[0])).toEqual(['2026-09', '2026-08']);
      expect(repository.countMonth).toHaveBeenCalledWith('2026-09', window, { userId: 'user-1' });
    });

    it('is a floor as soon as one month hit its ceiling', async () => {
      repository.countMonth
        .mockResolvedValueOnce({ total: 10_000, atLeast: true })
        .mockResolvedValueOnce({ total: 3, atLeast: false });

      expect(await service.count(window)).toEqual({ total: 10_003, atLeast: true });
    });

    it('counts one product off the per-item index', async () => {
      repository.countProduct.mockResolvedValue({ total: 5, atLeast: false });

      expect(await service.count({ ...window, productId: 'prod-1' })).toEqual({ total: 5, atLeast: false });
      expect(repository.countProduct).toHaveBeenCalledWith('prod-1', window, {});
      expect(repository.countMonth).not.toHaveBeenCalled();
    });

    it('rejects a window whose from is after to', async () => {
      await expect(
        service.count({ from: '2026-10-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
