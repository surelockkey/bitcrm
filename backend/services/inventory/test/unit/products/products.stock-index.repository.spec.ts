import { BadRequestException } from '@nestjs/common';
import { ProductType } from '@bitcrm/types';
import { ProductsRepository } from 'src/products/products.repository';
import { createMockDynamoDbService, createMockProduct } from '../mocks';

const encode = (key: Record<string, unknown>) => Buffer.from(JSON.stringify(key)).toString('base64url');

/**
 * Складські товари на розрідженій партиції GSI3 `PRODUCTS#STOCK` у порядку
 * назви: create пише ключі, будь-яке оновлення лишає рядок з правильними
 * ключами (або без них), а список "inventory products" читає лише її.
 */
describe('ProductsRepository — stock-managed index', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ProductsRepository;

  const stored = (overrides: Record<string, unknown> = {}) => ({
    ...createMockProduct({ id: 'prod-1', name: 'Chain Guard' }),
    PK: 'PRODUCT#prod-1',
    SK: 'METADATA',
    ...overrides,
  });

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    repository = new ProductsRepository(dynamoDb as any);
  });

  describe('create', () => {
    const putItem = () => dynamoDb.client.send.mock.calls[0][0].input.TransactItems[0].Put.Item;

    it('files a stock-managed product under the partition, by name', async () => {
      await repository.create(createMockProduct({ id: 'prod-1', name: ' Chain Guard ' }));

      expect(putItem()).toMatchObject({ GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'chain guard#prod-1' });
    });

    it('files neither a service nor an untracked product', async () => {
      await repository.create(createMockProduct({ type: ProductType.SERVICE }));
      await repository.create(createMockProduct({ sku: 'X-2', manageStock: false }));

      for (const call of dynamoDb.client.send.mock.calls) {
        expect(call[0].input.TransactItems[0].Put.Item).not.toHaveProperty('GSI3PK');
      }
    });
  });

  describe('update', () => {
    it('leaves the keys alone when the row already carries the right ones', async () => {
      dynamoDb.client.send.mockResolvedValue({
        // Filed on the Price Book partition too, so neither index needs a write.
        Attributes: stored({
          GSI3PK: 'PRODUCTS#STOCK',
          GSI3SK: 'chain guard#prod-1',
          GSI4PK: 'PRODUCTS#ALL',
          GSI4SK: 'chain guard#prod-1',
        }),
      });

      await repository.update('prod-1', { priceClient: 30 });

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('re-files a renamed product under its new name, conditioned on the row it read', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Attributes: stored({ name: 'Door Chain', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'chain guard#prod-1' }),
      });

      await repository.update('prod-1', { name: 'Door Chain' });

      const heal = dynamoDb.client.send.mock.calls[1][0].input;
      expect(heal.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(heal.UpdateExpression).toBe('SET GSI3PK = :stockPk, GSI3SK = :stockSk');
      expect(heal.ExpressionAttributeValues).toMatchObject({
        ':stockPk': 'PRODUCTS#STOCK',
        ':stockSk': 'door chain#prod-1',
        ':seenName': 'Door Chain',
        ':seenSk': 'chain guard#prod-1',
      });
      expect(heal.ConditionExpression).toContain('#name = :seenName');
    });

    it('takes a product out of the partition when its stock stops being managed', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Attributes: stored({ manageStock: false, GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'chain guard#prod-1' }),
      });

      await repository.update('prod-1', { manageStock: false });

      const heal = dynamoDb.client.send.mock.calls[1][0].input;
      expect(heal.UpdateExpression).toBe('REMOVE GSI3PK, GSI3SK');
      expect(heal.ConditionExpression).toContain('manageStock = :seenManage');
    });

    it('files a product whose flag was cleared with null — absent means managed', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({ Attributes: stored() });

      await repository.update('prod-1', { manageStock: null } as any);

      const heal = dynamoDb.client.send.mock.calls[1][0].input;
      expect(heal.ExpressionAttributeValues[':stockSk']).toBe('chain guard#prod-1');
    });

    it('lets a write that lost the race go — the later write re-files the row', async () => {
      const lost = new Error('The conditional request failed');
      lost.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockResolvedValueOnce({ Attributes: stored() }).mockRejectedValueOnce(lost);

      await expect(repository.update('prod-1', { priceClient: 1 })).resolves.toMatchObject({ id: 'prod-1' });
    });
  });

  describe('findStockManaged', () => {
    const row = (i: number) =>
      stored({
        id: `p-${i}`,
        PK: `PRODUCT#p-${i}`,
        name: `Item ${i}`,
        GSI3PK: 'PRODUCTS#STOCK',
        GSI3SK: `item ${i}#p-${i}`,
      });

    it('reads the partition in name order, one Query per page without filters', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row(1), row(2)], LastEvaluatedKey: undefined });

      const page = await repository.findStockManaged(50);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input).toMatchObject({
        IndexName: 'OwnerIndex',
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': 'PRODUCTS#STOCK' },
        ScanIndexForward: true,
        Limit: 50,
      });
      expect(input.FilterExpression).toBeUndefined();
      expect(page.items.map((p: { id: string }) => p.id)).toEqual(['p-1', 'p-2']);
      expect(page.items[0]).not.toHaveProperty('GSI3PK');
    });

    it('puts status, search, brand and type on top as a filter', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findStockManaged(50, undefined, {
        status: 'active',
        search: ' Chain Guard',
        brandId: 'b-1',
        type: 'product',
      });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toBe(
        '#type = :type AND #status = :status AND (contains(searchName, :search) OR contains(searchSku, :search)) AND brandId = :brandId',
      );
      expect(input.ExpressionAttributeValues).toMatchObject({ ':search': 'chain guard', ':pk': 'PRODUCTS#STOCK' });
    });

    // Партиція ~3 100 рядків: пошук, що збігається лише з рядками в кінці, має
    // дочитати її всю в межах бюджету — без порожньої сторінки з курсором.
    it.each([50, 20, 10])('finds a match at the far end of a 3 102-row partition at limit %i', async (limit) => {
      const partition = Array.from({ length: 3102 }, (_, i) => row(i));
      dynamoDb.client.send.mockImplementation(async (command: any) => {
        const { Limit, ExclusiveStartKey } = command.input;
        const start = ExclusiveStartKey ? partition.findIndex((r) => r.PK === ExclusiveStartKey.PK) + 1 : 0;
        const read = partition.slice(start, start + Limit);
        const end = start + read.length;
        return {
          // The filter keeps only the last two rows of the partition.
          Items: read.filter((r) => ['p-3100', 'p-3101'].includes(r.id as string)),
          LastEvaluatedKey: end < partition.length ? { PK: read[read.length - 1].PK } : undefined,
        };
      });

      const page = await repository.findStockManaged(limit, undefined, { search: 'item 310' });

      expect(page.items.map((p: { id: string }) => p.id)).toEqual(['p-3100', 'p-3101']);
      expect(page.nextCursor).toBeUndefined();
      expect(dynamoDb.client.send.mock.calls.length).toBeGreaterThan(1);
    });

    it('hands back a cursor with the index keys and resumes from it', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: [row(1), row(2), row(3)],
        LastEvaluatedKey: { PK: 'PRODUCT#p-9', SK: 'METADATA', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'item 9#p-9' },
      });

      const page = await repository.findStockManaged(2, undefined, { search: 'item' });

      const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
      expect(cursor).toEqual({ PK: 'PRODUCT#p-2', SK: 'METADATA', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'item 2#p-2' });

      dynamoDb.client.send.mockResolvedValueOnce({ Items: [] });
      await repository.findStockManaged(2, page.nextCursor, { search: 'item' });
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual(cursor);
    });

    // Пошук "mortise" знаходить 110: коли останнє читання, що дійшло до
    // кінця партиції, переповнювало сторінку, вона приходила довшою за
    // `limit` — 70 рядків під "Rows per page 50".
    it('never answers more than the limit, even when the last read ends the partition', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({ Items: [row(1), row(2), row(3)] });

      const page = await repository.findStockManaged(2, undefined, { search: 'item' });

      expect(page.items.map((p: { id: string }) => p.id)).toEqual(['p-1', 'p-2']);
      expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toEqual({
        PK: 'PRODUCT#p-2',
        SK: 'METADATA',
        GSI3PK: 'PRODUCTS#STOCK',
        GSI3SK: 'item 2#p-2',
      });
    });

    it('refuses a cursor from the Scan-era list with a 400', async () => {
      await expect(
        repository.findStockManaged(50, encode({ PK: 'PRODUCT#p-1', SK: 'METADATA' })),
      ).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });
  });

  describe('countStockManaged', () => {
    it('counts the partition under the same filters, without bodies', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 3102 });

      expect(await repository.countStockManaged({ status: 'active' })).toEqual({ total: 3102, atLeast: false });
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input).toMatchObject({
        IndexName: 'OwnerIndex',
        KeyConditionExpression: 'GSI3PK = :pk',
        Select: 'COUNT',
        FilterExpression: '#status = :status',
      });
    });
  });
});

/** Попап стоку локації бере поля товарів одним BatchGet на 100 ключів, а не 32 запитами. */
describe('ProductsRepository.findByIds', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ProductsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ProductsRepository(dynamoDb as any);
  });

  it('reads each product once by key and answers the ones that exist', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Responses: {
        BitCRM_Inventory: [{ ...createMockProduct({ id: 'p-1' }), PK: 'PRODUCT#p-1', SK: 'METADATA', GSI3PK: 'x' }],
      },
    });

    const products = await repository.findByIds(['p-1', 'p-2', 'p-1']);

    const sent = dynamoDb.client.send.mock.calls[0][0];
    expect(sent.constructor.name).toBe('BatchGetCommand');
    expect(Object.values(sent.input.RequestItems)[0]).toEqual({
      Keys: [
        { PK: 'PRODUCT#p-1', SK: 'METADATA' },
        { PK: 'PRODUCT#p-2', SK: 'METADATA' },
      ],
    });
    expect(products.map((p: { id: string }) => p.id)).toEqual(['p-1']);
    expect(products[0]).not.toHaveProperty('PK');
  });

  it('reads only the attributes asked for', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Responses: { BitCRM_Inventory: [{ id: 'p-1', name: 'Alpha', number: 12 }] },
    });

    const [product] = await repository.findByIds(['p-1'], { attributes: ['id', 'name', 'number'] });

    const asked = Object.values(dynamoDb.client.send.mock.calls[0][0].input.RequestItems)[0] as Record<string, unknown>;
    expect(asked.ProjectionExpression).toBe('#a0, #a1, #a2');
    expect(product).toMatchObject({ id: 'p-1', name: 'Alpha', number: 12 });
  });

  it('reads nothing for no ids', async () => {
    expect(await repository.findByIds([])).toEqual([]);
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });
});
