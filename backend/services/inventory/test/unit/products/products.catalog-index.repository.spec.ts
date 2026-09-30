import { BadRequestException } from '@nestjs/common';
import { ProductType } from '@bitcrm/types';
import { ProductsRepository } from 'src/products/products.repository';
import { createMockDynamoDbService, createMockProduct } from '../mocks';

const encode = (key: Record<string, unknown>) => Buffer.from(JSON.stringify(key)).toString('base64url');

/** The write that files a row on the catalog partition, if the call sent one. */
const catalogWrites = (send: jest.Mock) =>
  send.mock.calls
    .map((call) => call[0].input)
    .filter((input) => typeof input.UpdateExpression === 'string' && input.UpdateExpression.includes('GSI4PK'));

/**
 * Price Book: усі позиції в порядку назви на розділі GSI4 `PRODUCTS#ALL`.
 * create пише ключі, будь-яке оновлення лишає рядок з правильними ключами,
 * а список без категорії й без manageStock=true читає лише цей розділ.
 */
describe('ProductsRepository — catalog index (Price Book)', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ProductsRepository;

  const stored = (overrides: Record<string, unknown> = {}) => ({
    ...createMockProduct({ id: 'prod-1', name: 'Chain Guard' }),
    PK: 'PRODUCT#prod-1',
    SK: 'METADATA',
    GSI3PK: 'PRODUCTS#STOCK',
    GSI3SK: 'chain guard#prod-1',
    ...overrides,
  });

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    repository = new ProductsRepository(dynamoDb as any);
  });

  describe('create', () => {
    it('files every item on the catalog partition by name — products, services and untracked alike', async () => {
      await repository.create(createMockProduct({ id: 'prod-1', name: ' Chain Guard ' }));
      await repository.create(createMockProduct({ id: 'svc-1', sku: 'S-1', name: 'Rekey', type: ProductType.SERVICE }));
      await repository.create(createMockProduct({ id: 'prod-2', sku: 'X-2', name: 'Blank', manageStock: false }));

      const items = dynamoDb.client.send.mock.calls.map((call) => call[0].input.TransactItems[0].Put.Item);
      expect(items.map((item) => [item.GSI4PK, item.GSI4SK])).toEqual([
        ['PRODUCTS#ALL', 'chain guard#prod-1'],
        ['PRODUCTS#ALL', 'rekey#svc-1'],
        ['PRODUCTS#ALL', 'blank#prod-2'],
      ]);
    });
  });

  describe('update', () => {
    it('leaves the keys alone when the row already carries the right ones', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: stored({ GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'chain guard#prod-1' }),
      });

      await repository.update('prod-1', { priceClient: 30 });

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('re-files a renamed item under its new name, conditioned on the row it read', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Attributes: stored({
          name: 'Door Chain',
          GSI3SK: 'door chain#prod-1',
          GSI4PK: 'PRODUCTS#ALL',
          GSI4SK: 'chain guard#prod-1',
        }),
      });

      await repository.update('prod-1', { name: 'Door Chain' });

      const [heal] = catalogWrites(dynamoDb.client.send);
      expect(heal.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(heal.UpdateExpression).toBe('SET GSI4PK = :catalogPk, GSI4SK = :catalogSk');
      expect(heal.ConditionExpression).toBe('attribute_exists(PK) AND #name = :seenName AND GSI4SK = :seenCatalogSk');
      expect(heal.ExpressionAttributeValues).toEqual({
        ':catalogPk': 'PRODUCTS#ALL',
        ':catalogSk': 'door chain#prod-1',
        ':seenName': 'Door Chain',
        ':seenCatalogSk': 'chain guard#prod-1',
      });
    });

    it('files a row written before the partition existed on any edit — a service too', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Attributes: stored({ type: 'service', GSI3PK: undefined, GSI3SK: undefined }),
      });

      await repository.update('prod-1', { priceClient: 1 });

      expect(catalogWrites(dynamoDb.client.send)).toHaveLength(1);
      expect(catalogWrites(dynamoDb.client.send)[0].ExpressionAttributeValues[':catalogSk']).toBe('chain guard#prod-1');
    });

    it('lets a write that lost the race go — the later write re-files the row', async () => {
      const lost = new Error('The conditional request failed');
      lost.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockImplementation(async (command: any) => {
        const input = command.input;
        if (input.ReturnValues === 'ALL_NEW') return { Attributes: stored() };
        if (input.UpdateExpression?.includes('GSI4PK')) throw lost;
        return {};
      });

      await expect(repository.update('prod-1', { priceClient: 1 })).resolves.toMatchObject({ id: 'prod-1' });
    });

    it('does not swallow any other failure of the filing write', async () => {
      dynamoDb.client.send.mockImplementation(async (command: any) => {
        const input = command.input;
        if (input.ReturnValues === 'ALL_NEW') return { Attributes: stored() };
        if (input.UpdateExpression?.includes('GSI4PK')) throw new Error('throttled');
        return {};
      });

      await expect(repository.update('prod-1', { priceClient: 1 })).rejects.toThrow('throttled');
    });
  });

  describe('findCatalog', () => {
    const row = (i: number) =>
      stored({
        id: `p-${i}`,
        PK: `PRODUCT#p-${i}`,
        name: `Item ${i}`,
        GSI4PK: 'PRODUCTS#ALL',
        GSI4SK: `item ${i}#p-${i}`,
      });

    it('reads the partition in name order, one Query of exactly one page without filters', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row(1), row(2)], LastEvaluatedKey: undefined });

      const page = await repository.findCatalog(50);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input).toMatchObject({
        IndexName: 'TransferEntityIndex',
        KeyConditionExpression: 'GSI4PK = :pk',
        ExpressionAttributeValues: { ':pk': 'PRODUCTS#ALL' },
        ScanIndexForward: true,
        Limit: 50,
      });
      expect(input.FilterExpression).toBeUndefined();
      expect(page.items.map((p: { id: string }) => p.id)).toEqual(['p-1', 'p-2']);
      expect(page.items[0]).not.toHaveProperty('GSI4PK');
      expect(page.items[0]).not.toHaveProperty('GSI4SK');
      expect(page.nextCursor).toBeUndefined();
    });

    it('puts type, status, search, brand and manageStock=false on top as a filter', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findCatalog(50, undefined, {
        type: 'service',
        status: 'archived',
        search: ' Chain Guard',
        brandId: 'b-1',
        manageStock: false,
      });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('TransferEntityIndex');
      expect(input.FilterExpression).toBe(
        '#type = :type AND #status = :status AND ' +
          '(contains(searchName, :search) OR contains(searchSku, :search)) AND brandId = :brandId AND ' +
          'manageStock = :false',
      );
      expect(input.ExpressionAttributeNames).toEqual({ '#type': 'type', '#status': 'status' });
      expect(input.ExpressionAttributeValues).toMatchObject({
        ':pk': 'PRODUCTS#ALL',
        ':type': 'service',
        ':status': 'archived',
        ':search': 'chain guard',
        ':brandId': 'b-1',
        ':false': false,
      });
    });

    it('a blank search term is no filter at all', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findCatalog(20, undefined, { search: '   ' });

      expect(dynamoDb.client.send.mock.calls[0][0].input.FilterExpression).toBeUndefined();
    });

    // Розділ ~16 тис. рядків / ~16 МБ; DynamoDB віддає щонайбільше 1 МБ за
    // читання. Пошук, що збігається лише з двома останніми рядками, має
    // дочитати весь розділ одним запитом — без порожньої сторінки з курсором —
    // і не більше ніж за 40 читань, хоч би який був limit.
    it.each([100, 50, 20, 10])(
      'finds a match at the far end of a 16 142-row partition at limit %i, in 40 reads or fewer',
      async (limit) => {
        const partition = Array.from({ length: 16_142 }, (_, i) => row(i));
        const ROWS_PER_MB = 700; // ~1.5 KB rows: the 1 MB page cap binds before `Limit`
        dynamoDb.client.send.mockImplementation(async (command: any) => {
          const { Limit, ExclusiveStartKey } = command.input;
          const start = ExclusiveStartKey ? partition.findIndex((r) => r.PK === ExclusiveStartKey.PK) + 1 : 0;
          const read = partition.slice(start, start + Math.min(Limit, ROWS_PER_MB));
          const end = start + read.length;
          return {
            Items: read.filter((r) => ['p-16140', 'p-16141'].includes(r.id as string)),
            LastEvaluatedKey: end < partition.length ? { PK: read[read.length - 1].PK } : undefined,
          };
        });

        const page = await repository.findCatalog(limit, undefined, { search: 'item 1614' });

        expect(page.items.map((p: { id: string }) => p.id)).toEqual(['p-16140', 'p-16141']);
        expect(page.nextCursor).toBeUndefined();
        expect(dynamoDb.client.send.mock.calls.length).toBeLessThanOrEqual(40);
      },
    );

    it('hands back a cursor with the index keys and resumes from it', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: [row(1), row(2), row(3)],
        LastEvaluatedKey: { PK: 'PRODUCT#p-9', SK: 'METADATA', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'item 9#p-9' },
      });

      const page = await repository.findCatalog(2, undefined, { status: 'active' });

      const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
      expect(cursor).toEqual({ PK: 'PRODUCT#p-2', SK: 'METADATA', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'item 2#p-2' });

      dynamoDb.client.send.mockResolvedValueOnce({ Items: [] });
      await repository.findCatalog(2, page.nextCursor, { status: 'active' });
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual(cursor);
    });

    it('never answers more than the limit, even when the last read ends the partition', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({ Items: [row(1), row(2), row(3)] });

      const page = await repository.findCatalog(2, undefined, { status: 'active' });

      expect(page.items.map((p: { id: string }) => p.id)).toEqual(['p-1', 'p-2']);
      expect(page.nextCursor).toBeDefined();
    });

    it('refuses a Scan-era or stock-partition cursor with a 400, before any read', async () => {
      await expect(repository.findCatalog(50, encode({ PK: 'PRODUCT#p-1', SK: 'METADATA' }))).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        repository.findCatalog(
          50,
          encode({ PK: 'PRODUCT#p-1', SK: 'METADATA', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'item 1#p-1' }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });
  });

  describe('countCatalog', () => {
    it('counts the partition under the same filters, without bodies', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 7581 });

      expect(await repository.countCatalog({ status: 'active', type: 'product' })).toEqual({
        total: 7581,
        atLeast: false,
      });
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input).toMatchObject({
        IndexName: 'TransferEntityIndex',
        KeyConditionExpression: 'GSI4PK = :pk',
        Select: 'COUNT',
        FilterExpression: '#type = :type AND #status = :status',
      });
    });

    it('an unfiltered count stays a bare key count', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 3 });

      await repository.countCatalog();

      expect(dynamoDb.client.send.mock.calls[0][0].input.FilterExpression).toBeUndefined();
    });

    // 16 142 рядки по 1 МБ за читання — понад 20 читань (типовий бюджет
    // countRows); лічильник Price Book має бути точним, а не «7+».
    it('walks the whole ~16 MB partition to an exact answer', async () => {
      const ROWS_PER_MB = 700;
      let read = 0;
      dynamoDb.client.send.mockImplementation(async () => {
        const start = read * ROWS_PER_MB;
        read += 1;
        const count = Math.min(ROWS_PER_MB, 16_142 - start);
        return {
          Count: count,
          LastEvaluatedKey: start + count < 16_142 ? { PK: `PRODUCT#p-${start + count}` } : undefined,
        };
      });

      expect(await repository.countCatalog()).toEqual({ total: 16_142, atLeast: false });
    });
  });
});
