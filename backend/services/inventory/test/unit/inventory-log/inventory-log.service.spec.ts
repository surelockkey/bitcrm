import { BadRequestException } from '@nestjs/common';
import { InventoryLogAction } from '@bitcrm/types';
import { InventoryLogService } from 'src/inventory-log/inventory-log.service';
import { createMockInventoryLogEntry, createMockInventoryLogRepository } from '../mocks';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));

/**
 * Журнал читається по місячних партиціях: сервіс іде від місяця `to` вниз до
 * місяця `from` і добирає сторінку між ними, як scanPage добирає її між
 * читаннями. Курсор пам'ятає місяць, ключ і вікно, з якого продовжити.
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

  /** Собівартість у журналі — гроші: лише з financials.view. Ціна для клієнта лишається. */
  describe('list — costs', () => {
    const used = createMockInventoryLogEntry({
      id: 'log-used',
      action: InventoryLogAction.STOCK_USED,
      unitPrice: 25,
      unitCost: 10,
    });

    beforeEach(() => {
      repository.queryProduct.mockResolvedValue({ items: [used], lastKey: undefined, reads: 1 });
    });

    it('leaves unitCost out unless the caller may see money, keeping unitPrice', async () => {
      const page = await service.list({ productId: 'prod-1' });

      expect(page.items[0]).not.toHaveProperty('unitCost');
      expect(page.items[0].unitPrice).toBe(25);
    });

    it('keeps unitCost for a caller with financials.view', async () => {
      const page = await service.list({ productId: 'prod-1' }, { money: true });

      expect(page.items[0].unitCost).toBe(10);
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
        expect.any(Number),
      );
    });

    // `to` включний, як каже DTO: дата без часу — це весь той день, а не
    // його перша мілісекунда (інакше вибір "по 10 вересня" губив 10 вересня).
    it('normalises date-only bounds: from at the start of its day, to at the end of its day', async () => {
      await service.list({ from: '2026-08-15', to: '2026-09-10' });

      expect(repository.queryMonth).toHaveBeenCalledWith(
        '2026-09',
        { from: '2026-08-15T00:00:00.000Z', to: '2026-09-10T23:59:59.999Z' },
        {},
        20,
        undefined,
        expect.any(Number),
      );
    });

    it('spans the whole day when from and to are the same date', async () => {
      await service.list({ from: '2026-09-10', to: '2026-09-10' });

      expect(repository.queryMonth).toHaveBeenCalledWith(
        '2026-09',
        { from: '2026-09-10T00:00:00.000Z', to: '2026-09-10T23:59:59.999Z' },
        {},
        20,
        undefined,
        expect.any(Number),
      );
    });

    it('keeps a timestamped `to` as given', async () => {
      await service.list({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-10T08:30:00.000Z' });

      expect(repository.queryMonth.mock.calls[0][1]).toEqual({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-10T08:30:00.000Z',
      });
    });

    it('rejects a window whose from is after to', async () => {
      await expect(
        service.list({ from: '2026-10-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.queryMonth).not.toHaveBeenCalled();
    });

    // Лічильник іде по кожному місяцю вікна одним Query — без межі
    // `from=1970-01-01` це ~680 запитів, а `from=0001-01-01` не завершується.
    it('rejects a window wider than 24 months before reading anything', async () => {
      await expect(
        service.list({ from: '2024-08-01T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' }),
      ).rejects.toThrow(/24 months/);
      await expect(service.list({ from: '0001-01-01', to: '2026-09-29T12:00:00.000Z' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.list({ from: '1970-01-01' })).rejects.toThrow(BadRequestException);
      expect(repository.queryMonth).not.toHaveBeenCalled();
    });

    it('accepts a window of exactly 24 months', async () => {
      await service.list({ from: '2024-10-01T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' });

      expect(repository.queryMonth).toHaveBeenCalled();
    });

    it('walks from the month of `to` down to the month of `from`, filling the page across them', async () => {
      repository.queryMonth.mockImplementation(async (month: string) =>
        month === '2026-09'
          ? { items: [entry('sep-1'), entry('sep-2')], lastKey: undefined, reads: 1 }
          : { items: [entry('aug-1')], lastKey: undefined, reads: 1 },
      );

      const result = await service.list({ ...window, limit: 4 });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'sep-2', 'aug-1']);
      expect(result.nextCursor).toBeUndefined();
      expect(repository.queryMonth.mock.calls.map((c) => [c[0], c[3], c[4]])).toEqual([
        ['2026-09', 4, undefined],
        ['2026-08', 2, undefined],
      ]);
    });

    it('hands back a cursor inside the month that filled the page, carrying the window', async () => {
      repository.queryMonth.mockImplementation(async (month: string) =>
        month === '2026-09'
          ? { items: [entry('sep-1')], lastKey: undefined, reads: 1 }
          : { items: [entry('aug-1')], lastKey: { PK: 'INVLOG#2026-08', SK: 'k' }, reads: 1 },
      );

      const result = await service.list({ ...window, limit: 2 });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'aug-1']);
      expect(decode(result.nextCursor!)).toEqual({
        month: '2026-08',
        lastKey: { PK: 'INVLOG#2026-08', SK: 'k' },
        ...window,
      });
    });

    it('resumes in the month the cursor names, from its key', async () => {
      repository.queryMonth.mockResolvedValue({ items: [entry('aug-2')], lastKey: undefined, reads: 1 });
      const cursor = encode({ month: '2026-08', lastKey: { PK: 'INVLOG#2026-08', SK: 'k' }, ...window });

      const result = await service.list({ ...window, limit: 5, cursor });

      expect(result.items.map((i) => i.id)).toEqual(['aug-2']);
      expect(repository.queryMonth).toHaveBeenCalledTimes(1);
      expect(repository.queryMonth).toHaveBeenCalledWith(
        '2026-08',
        window,
        {},
        5,
        { PK: 'INVLOG#2026-08', SK: 'k' },
        expect.any(Number),
      );
    });

    /**
     * Вікно за замовчуванням рухається з часом: сторінка 1 о 23:58 30 вересня
     * бачить лише вересень, сторінка 2 о 00:01 1 жовтня бачила б лише
     * жовтень — і курсор із вереснем був би "недійсний". Курсор несе вікно.
     */
    it('reads page two against the window page one was minted with, even across a month boundary', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-30T23:58:00.000Z'));
      repository.queryMonth.mockResolvedValue({
        items: [entry('a'), entry('b')],
        lastKey: { PK: 'INVLOG#2026-09', SK: 'b' },
        reads: 1,
      });
      const first = await service.list({ limit: 2 });
      expect(decode(first.nextCursor!)).toEqual({
        month: '2026-09',
        lastKey: { PK: 'INVLOG#2026-09', SK: 'b' },
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-30T23:58:00.000Z',
      });

      jest.setSystemTime(new Date('2026-10-01T00:01:00.000Z'));
      repository.queryMonth.mockResolvedValue({ items: [entry('c')], lastKey: undefined, reads: 1 });
      const second = await service.list({ limit: 2, cursor: first.nextCursor });

      expect(second.items.map((i) => i.id)).toEqual(['c']);
      expect(repository.queryMonth).toHaveBeenLastCalledWith(
        '2026-09',
        { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:58:00.000Z' },
        {},
        2,
        { PK: 'INVLOG#2026-09', SK: 'b' },
        expect.any(Number),
      );
    });

    it('points the cursor at the next month when a month ends exactly on the page boundary', async () => {
      repository.queryMonth.mockResolvedValue({
        items: [entry('sep-1'), entry('sep-2')],
        lastKey: undefined,
        reads: 1,
      });

      const result = await service.list({ ...window, limit: 2 });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'sep-2']);
      expect(decode(result.nextCursor!)).toEqual({ month: '2026-08', ...window });
      expect(repository.queryMonth).toHaveBeenCalledTimes(1);
    });

    it('ends without a cursor when the last month ends on the page boundary', async () => {
      repository.queryMonth.mockResolvedValue({
        items: [entry('aug-1'), entry('aug-2')],
        lastKey: undefined,
        reads: 1,
      });

      const result = await service.list({ from: window.from, to: '2026-08-31T00:00:00.000Z', limit: 2 });

      expect(result.nextCursor).toBeUndefined();
    });

    it('keeps reading the same month while a filtered read comes back short', async () => {
      repository.queryMonth
        .mockResolvedValueOnce({ items: [entry('sep-1')], lastKey: { PK: 'INVLOG#2026-09', SK: 'a' }, reads: 1 })
        .mockResolvedValueOnce({ items: [entry('sep-2')], lastKey: undefined, reads: 1 })
        .mockResolvedValueOnce({ items: [], lastKey: undefined, reads: 1 });

      const result = await service.list({ ...window, limit: 3, userId: 'user-1' });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'sep-2']);
      expect(repository.queryMonth.mock.calls.map((c) => [c[0], c[3], c[4]])).toEqual([
        ['2026-09', 3, undefined],
        ['2026-09', 2, { PK: 'INVLOG#2026-09', SK: 'a' }],
        ['2026-08', 1, undefined],
      ]);
    });

    it('stops after its read budget and hands the position back rather than walk on', async () => {
      repository.queryMonth.mockResolvedValue({
        items: [],
        lastKey: { PK: 'INVLOG#2026-09', SK: 'z' },
        reads: 1,
      });

      const result = await service.list({ ...window, limit: 20, search: 'nothing matches' });

      expect(result.items).toEqual([]);
      expect(decode(result.nextCursor!)).toEqual({
        month: '2026-09',
        lastKey: { PK: 'INVLOG#2026-09', SK: 'z' },
        ...window,
      });
      expect(repository.queryMonth.mock.calls.length).toBeLessThanOrEqual(20);
    });

    /**
     * Бюджет — це реальні читання DynamoDB, не виклики репозиторію: один
     * фільтрований місяць сам може коштувати до 20 читань, тож репозиторій
     * отримує решту бюджету і повідомляє, скільки витратив.
     */
    it('charges the reads the repository reports and hands it only what is left of the budget', async () => {
      repository.queryMonth
        .mockResolvedValueOnce({ items: [], lastKey: { PK: 'INVLOG#2026-09', SK: 'a' }, reads: 15 })
        .mockResolvedValueOnce({ items: [entry('sep-1')], lastKey: { PK: 'INVLOG#2026-09', SK: 'b' }, reads: 5 });

      const result = await service.list({ ...window, limit: 20, userId: 'user-1' });

      expect(repository.queryMonth.mock.calls.map((c) => c[5])).toEqual([20, 5]);
      expect(result.items.map((i) => i.id)).toEqual(['sep-1']);
      expect(decode(result.nextCursor!)).toMatchObject({ month: '2026-09', lastKey: { SK: 'b' } });
      expect(repository.queryMonth).toHaveBeenCalledTimes(2);
    });

    // Порожня партиція — одне дешеве читання, вже обмежене шириною вікна; за
    // нього бюджет не платить, інакше широке вікно віддавало б порожні
    // сторінки з курсором, поки не переступить усі порожні місяці.
    it('walks empty months to the end of the window without handing back empty pages', async () => {
      repository.queryMonth.mockImplementation(async (month: string) =>
        month === '2026-09'
          ? { items: [entry('sep-1'), entry('sep-2')], lastKey: undefined, reads: 1 }
          : { items: [], lastKey: undefined, reads: 1 },
      );

      const result = await service.list({ from: '2024-10-01T00:00:00.000Z', to: window.to, limit: 3 });

      expect(result.items.map((i) => i.id)).toEqual(['sep-1', 'sep-2']);
      expect(result.nextCursor).toBeUndefined();
      expect(repository.queryMonth).toHaveBeenCalledTimes(24);
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
        expect.any(Number),
      );
    });

    it('reads one product off the per-item index instead of walking months', async () => {
      repository.queryProduct.mockResolvedValue({
        items: [entry('p-1')],
        lastKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' },
        reads: 1,
      });

      const result = await service.list({ ...window, productId: 'prod-1', limit: 1, userId: 'user-1' });

      expect(result.items.map((i) => i.id)).toEqual(['p-1']);
      expect(decode(result.nextCursor!)).toEqual({
        lastKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' },
        ...window,
      });
      expect(repository.queryProduct).toHaveBeenCalledWith('prod-1', window, { userId: 'user-1' }, 1, undefined);
      expect(repository.queryMonth).not.toHaveBeenCalled();
    });

    it('continues a per-item read from the cursor key', async () => {
      repository.queryProduct.mockResolvedValue({ items: [], lastKey: undefined, reads: 1 });
      const cursor = encode({ lastKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' }, ...window });

      const result = await service.list({ ...window, productId: 'prod-1', cursor });

      expect(result.nextCursor).toBeUndefined();
      expect(repository.queryProduct).toHaveBeenCalledWith('prod-1', window, {}, 20, {
        PK: 'x',
        SK: 'y',
        GSI4PK: 'p',
        GSI4SK: 'q',
      });
    });

    /**
     * Курсор місячного обходу — {month, lastKey: {PK, SK}}, курсор одного
     * товару — {lastKey: {…, GSI4PK, GSI4SK}}. Не той на не тому Query —
     * ValidationException від DynamoDB і 500; тут це 400 без читання.
     */
    describe('rejects a cursor that does not fit', () => {
      const monthCursor = encode({ month: '2026-09', lastKey: { PK: 'INVLOG#2026-09', SK: 'k' }, ...window });
      const productCursor = encode({ lastKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' }, ...window });

      it('that is not base64url JSON', async () => {
        await expect(service.list({ ...window, cursor: 'garbage' })).rejects.toThrow('Invalid cursor');
      });

      it('whose month is outside its own window', async () => {
        const cursor = encode({ month: '2026-03', ...window });
        await expect(service.list({ ...window, cursor })).rejects.toThrow('Invalid cursor');
      });

      it('that carries no window', async () => {
        const cursor = encode({ month: '2026-09', lastKey: { PK: 'INVLOG#2026-09', SK: 'k' } });
        await expect(service.list({ ...window, cursor })).rejects.toThrow('Invalid cursor');
      });

      it('minted for the month walk when a product is asked for', async () => {
        await expect(service.list({ ...window, productId: 'prod-1', cursor: monthCursor })).rejects.toThrow(
          'Invalid cursor',
        );
        expect(repository.queryProduct).not.toHaveBeenCalled();
      });

      it('minted for one product when the month walk is asked for', async () => {
        await expect(service.list({ ...window, cursor: productCursor })).rejects.toThrow('Invalid cursor');
        expect(repository.queryMonth).not.toHaveBeenCalled();
      });

      it('whose window is wider than the cap', async () => {
        const cursor = encode({ month: '2026-09', from: '2020-01-01T00:00:00.000Z', to: window.to });
        await expect(service.list({ cursor })).rejects.toThrow(BadRequestException);
        expect(repository.queryMonth).not.toHaveBeenCalled();
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

    // Далі сума й так лише "не менше ніж": решту місяців не варто читати.
    it('is a floor as soon as one month hit its ceiling, and stops walking there', async () => {
      repository.countMonth
        .mockResolvedValueOnce({ total: 10_000, atLeast: true })
        .mockResolvedValueOnce({ total: 3, atLeast: false });

      expect(await service.count({ from: '2024-10-01T00:00:00.000Z', to: window.to })).toEqual({
        total: 10_000,
        atLeast: true,
      });
      expect(repository.countMonth).toHaveBeenCalledTimes(1);
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

    it('rejects a window wider than 24 months before counting anything', async () => {
      await expect(service.count({ from: '1970-01-01' })).rejects.toThrow(BadRequestException);
      await expect(service.count({ from: '0001-01-01' })).rejects.toThrow(BadRequestException);
      expect(repository.countMonth).not.toHaveBeenCalled();
    });

    it('treats a date-only `to` as the whole day', async () => {
      await service.count({ from: '2026-09-10', to: '2026-09-10' });

      expect(repository.countMonth).toHaveBeenCalledWith(
        '2026-09',
        { from: '2026-09-10T00:00:00.000Z', to: '2026-09-10T23:59:59.999Z' },
        {},
      );
    });

    /**
     * Як і лічильники товарів, складів і контейнерів: за 30 секунд число не
     * встигає стати неправильним, а кожен клік по фільтру не повинен знову
     * читати кожен місяць вікна.
     */
    describe('behind a short cache', () => {
      let store: Map<string, string>;
      let cached: InventoryLogService;

      beforeEach(() => {
        store = new Map<string, string>();
        const redis = {
          client: {
            get: jest.fn(async (k: string) => store.get(k) ?? null),
            set: jest.fn(async (k: string, v: string) => {
              store.set(k, v);
              return 'OK';
            }),
          },
        };
        cached = new InventoryLogService(repository as any, redis as any);
        repository.countMonth.mockResolvedValue({ total: 2, atLeast: false });
      });

      it('answers a repeat from the cache rather than re-walking the months', async () => {
        expect(await cached.count(window)).toEqual({ total: 4, atLeast: false });
        expect(await cached.count(window)).toEqual({ total: 4, atLeast: false });

        expect(repository.countMonth).toHaveBeenCalledTimes(2);
        expect(store.size).toBe(1);
      });

      it('keeps each filter combination on its own key', async () => {
        await cached.count(window);
        await cached.count({ ...window, userId: 'user-1' });
        await cached.count({ ...window, action: InventoryLogAction.STOCK_USED });

        expect(store.size).toBe(3);
      });

      it('shares one key for the default window whatever the millisecond', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
        await cached.count({});
        jest.setSystemTime(new Date('2026-09-29T12:00:05.000Z'));
        await cached.count({});

        expect(store.size).toBe(1);
        expect(repository.countMonth).toHaveBeenCalledTimes(1);
      });

      it('works with no Redis at all', async () => {
        expect(await service.count(window)).toEqual({ total: 4, atLeast: false });
      });
    });
  });
});
