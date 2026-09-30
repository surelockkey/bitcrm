import {
  InventoryUsageRepository,
  UsageConflictError,
} from 'src/inventory-usage/inventory-usage.repository';
import {
  usageKey,
  usagePointerKey,
  usageSearchText,
} from 'src/inventory-usage/inventory-usage.constants';
import { createMockDynamoDbService, createMockStoredUsageRow } from '../mocks';

const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
const transactionCanceled = () => Object.assign(new Error('Transaction cancelled'), { name: 'TransactionCanceledException' });

const storedUsageRow = createMockStoredUsageRow;

/**
 * Проєкція використання: рядок на (роботу, товар) у партиції місяця ДАТИ
 * РОБОТИ, плюс вказівник USAGE_OF#<dealId> / PRODUCT#<productId> на поточне
 * місце рядка — щоб повернення й перенесення роботи знаходили його.
 */
describe('inventory-usage keys', () => {
  it('files a row under the month of the job date, sorted by date then job then item', () => {
    expect(usageKey('2026-09-10', 'deal-1', 'prod-1')).toEqual({
      PK: 'USAGE#2026-09',
      SK: '2026-09-10#deal-1#prod-1',
    });
  });

  it('points from the job and product to the row', () => {
    expect(usagePointerKey('deal-1', 'prod-1')).toEqual({ PK: 'USAGE_OF#deal-1', SK: 'PRODUCT#prod-1' });
  });

  it('searches item, SKU, job number and client, lowercased', () => {
    expect(
      usageSearchText({ productName: 'Steel Ball', sku: 'SB-1', dealNumber: 'K4T9ZW', clientName: 'Kristie S' }),
    ).toBe('steel ball sb-1 k4t9zw kristie s');
    expect(usageSearchText({ productName: 'Rekey' })).toBe('rekey');
  });
});

describe('InventoryUsageRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: InventoryUsageRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    repository = new InventoryUsageRepository(dynamoDb as any);
  });

  const input = (call = 0) => dynamoDb.client.send.mock.calls[call][0].input;

  describe('getPointer', () => {
    it('reads the pointer consistently and answers the row key it names', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: { PK: 'USAGE_OF#deal-1', SK: 'PRODUCT#prod-1', usagePK: 'USAGE#2026-09', usageSK: '2026-09-10#deal-1#prod-1' },
      });

      expect(await repository.getPointer('deal-1', 'prod-1')).toEqual({
        PK: 'USAGE#2026-09',
        SK: '2026-09-10#deal-1#prod-1',
      });
      expect(input()).toMatchObject({ Key: { PK: 'USAGE_OF#deal-1', SK: 'PRODUCT#prod-1' }, ConsistentRead: true });
    });

    it('answers null when the job never used the item', async () => {
      expect(await repository.getPointer('deal-1', 'prod-1')).toBeNull();
    });
  });

  describe('listPointers', () => {
    it("reads every pointer of the job, across pages", async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({
          Items: [{ productId: 'prod-1', usagePK: 'USAGE#2026-09', usageSK: 'a' }],
          LastEvaluatedKey: { PK: 'x' },
        })
        .mockResolvedValueOnce({ Items: [{ productId: 'prod-2', usagePK: 'USAGE#2026-08', usageSK: 'b' }] });

      expect(await repository.listPointers('deal-1')).toEqual([
        { productId: 'prod-1', PK: 'USAGE#2026-09', SK: 'a' },
        { productId: 'prod-2', PK: 'USAGE#2026-08', SK: 'b' },
      ]);
      expect(input(0)).toMatchObject({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'USAGE_OF#deal-1' },
      });
      expect(input(1).ExclusiveStartKey).toEqual({ PK: 'x' });
    });
  });

  describe('getRow', () => {
    it('reads consistently and hands the containers back as a sorted list, without searchText', async () => {
      const { containerIds: _c, ...rest } = storedUsageRow();
      dynamoDb.client.send.mockResolvedValue({
        Item: { ...rest, containerIds: new Set(['c-2', 'c-1']), searchText: 'x' },
      });

      const row = await repository.getRow(usageKey('2026-09-10', 'deal-1', 'prod-1'));

      expect(row?.containerIds).toEqual(['c-1', 'c-2']);
      expect(row).not.toHaveProperty('searchText');
      expect(row?.PK).toBe('USAGE#2026-09');
      expect(input().ConsistentRead).toBe(true);
    });

    it('reads an importer row that stored the containers as a list, or none', async () => {
      const { containerIds: _c, techIds: _t, ...rest } = storedUsageRow();
      dynamoDb.client.send.mockResolvedValueOnce({ Item: { ...rest, containerIds: ['c-9'] } });
      dynamoDb.client.send.mockResolvedValueOnce({ Item: rest });

      expect((await repository.getRow(usageKey('2026-09-10', 'deal-1', 'prod-1')))?.containerIds).toEqual(['c-9']);
      const bare = await repository.getRow(usageKey('2026-09-10', 'deal-1', 'prod-1'));
      expect(bare?.containerIds).toEqual([]);
      expect(bare?.techIds).toEqual([]);
    });
  });

  describe('create', () => {
    const row = storedUsageRow();

    it('writes the row with ADD qty (two first uses at once add up) and its pointer, in one transaction', async () => {
      await repository.create(row);

      const { TransactItems } = input();
      const update = TransactItems[0].Update;
      expect(update.Key).toEqual({ PK: 'USAGE#2026-09', SK: '2026-09-10#deal-1#prod-1' });
      expect(update.UpdateExpression).toMatch(/ADD qty :qty, containerIds :containerIds/);
      // Every attribute is aliased: `number` and `source` are DynamoDB reserved words.
      expect(update.UpdateExpression).toMatch(/#firstUsedAt = if_not_exists\(#firstUsedAt, :firstUsedAt\)/);
      expect(update.UpdateExpression).toMatch(/#source = if_not_exists\(#source, :source\)/);
      expect(update.ExpressionAttributeNames).toMatchObject({ '#source': 'source', '#productName': 'productName' });
      expect(update.ExpressionAttributeValues[':qty']).toBe(2);
      expect(update.ExpressionAttributeValues[':containerIds']).toEqual(new Set(['c-1']));
      expect(update.ExpressionAttributeValues[':searchText']).toBe('steel ball bearing sb-1 k4t9zw kristie spegal');
      expect(update.ExpressionAttributeValues[':techIds']).toEqual(['tech-1']);

      const pointer = TransactItems[1].Put;
      expect(pointer.Item).toEqual({
        PK: 'USAGE_OF#deal-1',
        SK: 'PRODUCT#prod-1',
        dealId: 'deal-1',
        productId: 'prod-1',
        usagePK: 'USAGE#2026-09',
        usageSK: '2026-09-10#deal-1#prod-1',
      });
      expect(pointer.ConditionExpression).toBe(
        'attribute_not_exists(PK) OR (usagePK = :usagePK AND usageSK = :usageSK)',
      );
    });

    it('leaves out what the row does not know rather than writing undefined', async () => {
      await repository.create(
        storedUsageRow({ sku: undefined, category: undefined, unitPrice: undefined, clientName: undefined }),
      );

      const values = input().TransactItems[0].Update.ExpressionAttributeValues;
      expect(Object.values(values)).not.toContain(undefined);
      expect(values).not.toHaveProperty(':sku');
      expect(values).not.toHaveProperty(':unitPrice');
    });

    it('may replace a pointer that names a row which no longer exists', async () => {
      await repository.create(row, { PK: 'USAGE#2026-01', SK: 'gone' });

      const pointer = input().TransactItems[1].Put;
      expect(pointer.ConditionExpression).toBe('attribute_not_exists(PK) OR (usagePK = :oldPK AND usageSK = :oldSK)');
      expect(pointer.ExpressionAttributeValues).toEqual({ ':oldPK': 'USAGE#2026-01', ':oldSK': 'gone' });
    });

    it('is a conflict when the pointer moved meanwhile', async () => {
      dynamoDb.client.send.mockRejectedValue(transactionCanceled());

      await expect(repository.create(row)).rejects.toBeInstanceOf(UsageConflictError);
    });
  });

  describe('addUse', () => {
    const key = usageKey('2026-09-10', 'deal-1', 'prod-1');

    it('adds the units and the container to the existing row, refreshing the item and its prices', async () => {
      await repository.addUse(key, {
        qty: 3,
        containerId: 'c-2',
        at: '2026-09-12T10:00:00.000Z',
        productName: 'Steel Ball Bearing',
        sku: 'SB-1',
        category: 'Keys',
        unitPrice: 30,
        unitCost: 12,
      });

      const update = input();
      expect(update.Key).toEqual(key);
      expect(update.UpdateExpression).toMatch(/^ADD qty :qty, containerIds :containerIds SET /);
      expect(update.UpdateExpression).toContain('#lastUsedAt = :lastUsedAt');
      expect(update.UpdateExpression).toContain('#unitPrice = :unitPrice');
      expect(update.ExpressionAttributeNames['#number']).toBeUndefined();
      expect(update.ConditionExpression).toBe('attribute_exists(PK)');
      expect(update.ExpressionAttributeValues).toMatchObject({
        ':qty': 3,
        ':containerIds': new Set(['c-2']),
        ':lastUsedAt': '2026-09-12T10:00:00.000Z',
        ':category': 'Keys',
        ':unitPrice': 30,
        ':unitCost': 12,
      });
    });

    it('is a conflict when the row moved away meanwhile', async () => {
      dynamoDb.client.send.mockRejectedValue(conditionFailed());

      await expect(
        repository.addUse(key, { qty: 1, containerId: 'c-1', at: '2026-09-12T10:00:00.000Z', productName: 'X' }),
      ).rejects.toBeInstanceOf(UsageConflictError);
    });

    it('lets any other failure through', async () => {
      dynamoDb.client.send.mockRejectedValue(new Error('throttled'));

      await expect(
        repository.addUse(key, { qty: 1, containerId: 'c-1', at: '2026-09-12T10:00:00.000Z', productName: 'X' }),
      ).rejects.toThrow('throttled');
    });
  });

  describe('addRestore', () => {
    it('takes the units off, keeping the row even at zero', async () => {
      const key = usageKey('2026-09-10', 'deal-1', 'prod-1');

      await repository.addRestore(key, 2, '2026-09-12T10:00:00.000Z');

      expect(input()).toMatchObject({
        Key: key,
        UpdateExpression: 'ADD qty :qty SET lastRestoredAt = :at',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':qty': -2, ':at': '2026-09-12T10:00:00.000Z' },
      });
    });
  });

  describe('replace', () => {
    const current = storedUsageRow();

    it('rewrites a row in place when its key stays, guarded on the quantity it was read with', async () => {
      await repository.replace(current, { ...current, clientName: 'New Name' });

      const put = input();
      expect(put.Item).toMatchObject({
        PK: 'USAGE#2026-09',
        SK: '2026-09-10#deal-1#prod-1',
        clientName: 'New Name',
        containerIds: new Set(['c-1']),
        searchText: 'steel ball bearing sb-1 k4t9zw new name',
      });
      expect(put.ConditionExpression).toBe('qty = :qty');
      expect(put.ExpressionAttributeValues).toEqual({ ':qty': 2 });
    });

    it('moves a row to its new key, deletes the old one and repoints, in one transaction', async () => {
      const moved = { ...current, ...usageKey('2026-10-02', 'deal-1', 'prod-1'), jobDate: '2026-10-02' };

      await repository.replace(current, moved);

      const [put, del, pointer] = input().TransactItems;
      expect(put.Put.Item).toMatchObject({ PK: 'USAGE#2026-10', SK: '2026-10-02#deal-1#prod-1', jobDate: '2026-10-02' });
      expect(del.Delete).toMatchObject({
        Key: { PK: 'USAGE#2026-09', SK: '2026-09-10#deal-1#prod-1' },
        ConditionExpression: 'qty = :qty',
        ExpressionAttributeValues: { ':qty': 2 },
      });
      expect(pointer.Put.Item).toMatchObject({
        PK: 'USAGE_OF#deal-1',
        SK: 'PRODUCT#prod-1',
        usagePK: 'USAGE#2026-10',
        usageSK: '2026-10-02#deal-1#prod-1',
      });
    });

    it('stores no container set when the row has none (DynamoDB has no empty set)', async () => {
      await repository.replace(current, { ...current, containerIds: [] });

      expect(input().Item).not.toHaveProperty('containerIds');
    });

    it('is a conflict when the row changed since it was read', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(conditionFailed());
      await expect(repository.replace(current, { ...current, clientName: 'X' })).rejects.toBeInstanceOf(
        UsageConflictError,
      );

      dynamoDb.client.send.mockRejectedValueOnce(transactionCanceled());
      await expect(
        repository.replace(current, { ...current, ...usageKey('2026-10-02', 'deal-1', 'prod-1'), jobDate: '2026-10-02' }),
      ).rejects.toBeInstanceOf(UsageConflictError);
    });
  });
});
