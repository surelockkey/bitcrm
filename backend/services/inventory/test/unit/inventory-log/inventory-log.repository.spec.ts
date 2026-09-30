import { InventoryLogAction } from '@bitcrm/types';
import { InventoryLogRepository } from 'src/inventory-log/inventory-log.repository';
import {
  invlogMonth,
  invlogPartition,
  invlogProductPartition,
  invlogSearchText,
  invlogSortKey,
  monthsDescending,
  previousMonth,
} from 'src/inventory-log/inventory-log.constants';
import { createMockDynamoDbService, createMockInventoryLogEntry } from '../mocks';

/**
 * Журнал інвентарю лежить у спільній таблиці по місячних партиціях: одна
 * стала партиція на весь журнал — це знову урок CALL#ALL (гаряча партиція й
 * фільтрований Query, що читає роки заради сторінки).
 */
describe('inventory-log key helpers', () => {
  it('takes the UTC month out of createdAt', () => {
    expect(invlogMonth('2026-09-29T23:59:59.000Z')).toBe('2026-09');
    expect(invlogMonth('2026-01-01T00:00:00.000Z')).toBe('2026-01');
  });

  it('builds the partition, sort and per-product keys', () => {
    expect(invlogPartition('2026-09')).toBe('INVLOG#2026-09');
    expect(invlogSortKey('2026-09-29T10:00:00.000Z', 'log-1')).toBe('2026-09-29T10:00:00.000Z#log-1');
    expect(invlogProductPartition('prod-1')).toBe('INVLOG#PRODUCT#prod-1');
  });

  it('lowercases name and sku into the search text', () => {
    expect(invlogSearchText('Kwikset Deadbolt', 'WZ-10707')).toBe('kwikset deadbolt wz-10707');
    expect(invlogSearchText('Rekey')).toBe('rekey');
    expect(invlogSearchText(undefined)).toBe('');
  });

  it('steps back a month across the year boundary', () => {
    expect(previousMonth('2026-03')).toBe('2026-02');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('lists the months newest first, both ends included', () => {
    expect(monthsDescending('2025-11', '2026-02')).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
    expect(monthsDescending('2026-09', '2026-09')).toEqual(['2026-09']);
    expect(monthsDescending('2026-10', '2026-09')).toEqual([]);
  });
});

describe('InventoryLogRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: InventoryLogRepository;

  const window = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-29T12:00:00.000Z' };

  const row = (id: string, createdAt = '2026-09-10T10:00:00.000Z') => ({
    ...createMockInventoryLogEntry({ id, createdAt }),
    PK: 'INVLOG#2026-09',
    SK: `${createdAt}#${id}`,
    GSI4PK: 'INVLOG#PRODUCT#prod-1',
    GSI4SK: `${createdAt}#${id}`,
    searchText: 'test product sku-001',
  });

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    repository = new InventoryLogRepository(dynamoDb as any);
  });

  describe('create', () => {
    it('writes the row under its month with the per-product index keys and search text', async () => {
      const entry = createMockInventoryLogEntry({
        id: 'log-1',
        createdAt: '2026-09-29T10:00:00.000Z',
        productName: 'Kwikset Deadbolt',
        sku: 'WZ-10707',
      });

      await repository.create(entry);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.Item).toEqual({
        PK: 'INVLOG#2026-09',
        SK: '2026-09-29T10:00:00.000Z#log-1',
        GSI4PK: 'INVLOG#PRODUCT#prod-1',
        GSI4SK: '2026-09-29T10:00:00.000Z#log-1',
        searchText: 'kwikset deadbolt wz-10707',
        ...entry,
      });
    });

    it('leaves a missing sku out of the search text', async () => {
      await repository.create(createMockInventoryLogEntry({ sku: undefined, productName: 'Rekey' }));

      expect(dynamoDb.client.send.mock.calls[0][0].input.Item.searchText).toBe('rekey');
    });

    // Призначення фургона не має товару: жодного ключа GSI4 (інакше рядок ліг
    // би в партицію `INVLOG#PRODUCT#undefined`), а пошук іде за ім'ям людини.
    it('writes an item-less entry under its month only, searchable by the subject user', async () => {
      const entry = createMockInventoryLogEntry({
        id: 'log-2',
        createdAt: '2026-09-30T08:00:00.000Z',
        action: InventoryLogAction.CONTAINER_ASSIGNED,
        productId: undefined,
        productName: undefined,
        sku: undefined,
        quantity: undefined,
        subjectUserId: 'tech-1',
        subjectUserName: 'Mike Ross',
        toId: 'c-1',
        toName: '(12) MIKE',
      });

      await repository.create(entry);

      const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
      expect(item.PK).toBe('INVLOG#2026-09');
      expect(item.SK).toBe('2026-09-30T08:00:00.000Z#log-2');
      expect(item).not.toHaveProperty('GSI4PK');
      expect(item).not.toHaveProperty('GSI4SK');
      expect(item.searchText).toBe('mike ross');
    });
  });

  describe('queryMonth', () => {
    it('queries one month partition, newest first, bounded by the window', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row('log-1')] });

      const page = await repository.queryMonth('2026-09', window, {}, 20);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.KeyConditionExpression).toBe('PK = :pk AND SK BETWEEN :from AND :to');
      expect(input.ExpressionAttributeValues).toEqual({
        ':pk': 'INVLOG#2026-09',
        ':from': '2026-09-01T00:00:00.000Z',
        ':to': '2026-09-29T12:00:00.000Z#~',
      });
      expect(input.ScanIndexForward).toBe(false);
      expect(input.Limit).toBe(20);
      expect(input.FilterExpression).toBeUndefined();
      expect(input.IndexName).toBeUndefined();
      expect(page.items).toEqual([createMockInventoryLogEntry({ id: 'log-1' })]);
      expect(page.lastKey).toBeUndefined();
      expect(page.reads).toBe(1);
    });

    // Дата без часу як `to` — весь той день: рядок о 14:00 має бути нижче межі.
    it('bounds the window so a row late in the day of `to` still falls inside', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.queryMonth(
        '2026-09',
        { from: '2026-09-10T00:00:00.000Z', to: '2026-09-10T23:59:59.999Z' },
        {},
        20,
      );

      const values = dynamoDb.client.send.mock.calls[0][0].input.ExpressionAttributeValues;
      const rowSK = invlogSortKey('2026-09-10T14:00:00.000Z', 'abc');
      expect(rowSK >= values[':from'] && rowSK <= values[':to']).toBe(true);
    });

    it('hands the last key back and resumes from a start key', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Items: [row('log-1')],
        LastEvaluatedKey: { PK: 'INVLOG#2026-09', SK: 'x' },
      });

      const page = await repository.queryMonth('2026-09', window, {}, 1, { PK: 'INVLOG#2026-09', SK: 'y' });

      expect(dynamoDb.client.send.mock.calls[0][0].input.ExclusiveStartKey).toEqual({
        PK: 'INVLOG#2026-09',
        SK: 'y',
      });
      expect(page.lastKey).toEqual({ PK: 'INVLOG#2026-09', SK: 'x' });
    });

    it('puts userId, action and the search term into the filter and fills the page', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [row('log-1')], LastEvaluatedKey: { PK: 'INVLOG#2026-09', SK: 'a' } })
        .mockResolvedValueOnce({ Items: [row('log-2')] });

      const page = await repository.queryMonth(
        '2026-09',
        window,
        { userId: 'user-1', action: InventoryLogAction.STOCK_USED, search: 'Deadbolt' },
        2,
      );

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toBe(
        'userId = :userId AND #action = :action AND contains(searchText, :search)',
      );
      expect(input.ExpressionAttributeNames).toEqual({ '#action': 'action' });
      expect(input.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ':userId': 'user-1',
          ':action': 'stock_used',
          ':search': 'deadbolt',
        }),
      );
      // A filtered read asks for more than the page, so the filter has rows to drop.
      expect(input.Limit).toBeGreaterThan(2);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(page.items.map((i) => i.id)).toEqual(['log-1', 'log-2']);
      expect(page.lastKey).toBeUndefined();
      expect(page.reads).toBe(2);
    });

    // Сервіс ділить один бюджет читань між місяцями: фільтрований місяць
    // отримує лише його решту й каже, скільки витратив.
    it('spends at most the reads it is given on a filtered month and reports them', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: { PK: 'INVLOG#2026-09', SK: 'more' },
      });

      const page = await repository.queryMonth('2026-09', window, { userId: 'user-1' }, 5, undefined, 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
      expect(page.reads).toBe(3);
      expect(page.lastKey).toEqual({ PK: 'INVLOG#2026-09', SK: 'more' });
    });

    it('cuts an overshooting filtered read to the page and points the key at the last row kept', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: [row('log-1'), row('log-2'), row('log-3')],
        LastEvaluatedKey: { PK: 'INVLOG#2026-09', SK: 'far' },
      });

      const page = await repository.queryMonth('2026-09', window, { userId: 'user-1' }, 2);

      expect(page.items.map((i) => i.id)).toEqual(['log-1', 'log-2']);
      expect(page.lastKey).toEqual({ PK: 'INVLOG#2026-09', SK: '2026-09-10T10:00:00.000Z#log-2' });
    });
  });

  describe('queryProduct', () => {
    it('reads the per-item history off GSI4, newest first, within the window', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row('log-1')] });

      const page = await repository.queryProduct('prod-1', window, {}, 20);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('TransferEntityIndex');
      expect(input.KeyConditionExpression).toBe('GSI4PK = :pk AND GSI4SK BETWEEN :from AND :to');
      expect(input.ExpressionAttributeValues).toEqual({
        ':pk': 'INVLOG#PRODUCT#prod-1',
        ':from': '2026-09-01T00:00:00.000Z',
        ':to': '2026-09-29T12:00:00.000Z#~',
      });
      expect(input.ScanIndexForward).toBe(false);
      expect(page.items).toEqual([createMockInventoryLogEntry({ id: 'log-1' })]);
    });

    it('keeps the index keys in the cursor when a filtered read overshoots', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: [row('log-1'), row('log-2')],
        LastEvaluatedKey: { PK: 'x', SK: 'y', GSI4PK: 'p', GSI4SK: 'q' },
      });

      const page = await repository.queryProduct('prod-1', window, { action: InventoryLogAction.STOCK_MOVED }, 1);

      expect(page.items.map((i) => i.id)).toEqual(['log-1']);
      expect(page.lastKey).toEqual({
        PK: 'INVLOG#2026-09',
        SK: '2026-09-10T10:00:00.000Z#log-1',
        GSI4PK: 'INVLOG#PRODUCT#prod-1',
        GSI4SK: '2026-09-10T10:00:00.000Z#log-1',
      });
    });
  });

  describe('countMonth', () => {
    it('counts the month under the same key condition and filter, without bodies', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 7 });

      const result = await repository.countMonth('2026-09', window, { userId: 'user-1' });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.Select).toBe('COUNT');
      expect(input.KeyConditionExpression).toBe('PK = :pk AND SK BETWEEN :from AND :to');
      expect(input.FilterExpression).toBe('userId = :userId');
      expect(input.ExpressionAttributeValues[':pk']).toBe('INVLOG#2026-09');
      expect(result).toEqual({ total: 7, atLeast: false });
    });

    it('sums across the walk', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Count: 4, LastEvaluatedKey: { PK: 'INVLOG#2026-09', SK: 'a' } })
        .mockResolvedValueOnce({ Count: 3 });

      expect(await repository.countMonth('2026-09', window, {})).toEqual({ total: 7, atLeast: false });
    });
  });

  describe('countProduct', () => {
    it('counts one product off GSI4 under the window and filters, without bodies', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 3 });

      const result = await repository.countProduct('prod-1', window, { action: InventoryLogAction.STOCK_USED });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('TransferEntityIndex');
      expect(input.Select).toBe('COUNT');
      expect(input.KeyConditionExpression).toBe('GSI4PK = :pk AND GSI4SK BETWEEN :from AND :to');
      expect(input.ExpressionAttributeValues).toEqual({
        ':pk': 'INVLOG#PRODUCT#prod-1',
        ':from': '2026-09-01T00:00:00.000Z',
        ':to': '2026-09-29T12:00:00.000Z#~',
        ':action': 'stock_used',
      });
      expect(input.FilterExpression).toBe('#action = :action');
      expect(result).toEqual({ total: 3, atLeast: false });
    });
  });
});
