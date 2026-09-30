import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { DynamoDbService, RedisService } from '@bitcrm/shared';
import { StockRepository } from 'src/stock/stock.repository';
import { productCacheKey } from 'src/products/products-cache.service';
import { INVENTORY_TABLE } from 'src/common/constants/dynamo.constants';
import {
  createMockStockItem,
  createMockDynamoDbService,
  createMockRedisService,
} from '../mocks';

/** What DynamoDB throws when a TransactWrite fails — one reason per item, in order. */
function transactionCanceled(codes: string[]): Error {
  const error = new Error('Transaction cancelled');
  error.name = 'TransactionCanceledException';
  (error as Error & { CancellationReasons: { Code: string }[] }).CancellationReasons = codes.map(
    (Code) => ({ Code }),
  );
  return error;
}

describe('StockRepository', () => {
  let repository: StockRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let redis: ReturnType<typeof createMockRedisService>;

  const sent = (n = 0) => dynamoDb.client.send.mock.calls[n][0];

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();
    redis = createMockRedisService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockRepository,
        { provide: DynamoDbService, useValue: dynamoDb },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    repository = module.get<StockRepository>(StockRepository);
  });

  describe('getStockLevel', () => {
    it('should return stock item when found', async () => {
      const stockItem = createMockStockItem();
      dynamoDb.client.send.mockResolvedValue({
        Item: { ...stockItem, PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' },
      });

      const result = await repository.getStockLevel('WAREHOUSE#wh-1', 'prod-1');

      expect(result).toBeDefined();
      expect(result!.productId).toBe('prod-1');
      expect(result!.quantity).toBe(10);
    });

    it('should return null when not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: undefined });

      const result = await repository.getStockLevel('WAREHOUSE#wh-1', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getStockLevels', () => {
    it('should return all stock items for entity', async () => {
      const stockItem = createMockStockItem();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...stockItem, PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' }],
      });

      const result = await repository.getStockLevels('WAREHOUSE#wh-1');

      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe('prod-1');
    });

    it('should return empty array when no stock items', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      const result = await repository.getStockLevels('WAREHOUSE#wh-1');

      expect(result).toEqual([]);
    });

    it('should handle undefined Items', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: undefined });

      const result = await repository.getStockLevels('WAREHOUSE#wh-1');

      expect(result).toEqual([]);
    });

    // Склад із тисячами рядків STOCK# перевищує 1 МБ однієї сторінки Query:
    // без дочитування решта товарів мовчки зникала.
    it('reads the partition to the end, page by page', async () => {
      const lastKey = { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p-1' };
      dynamoDb.client.send
        .mockResolvedValueOnce({
          Items: [{ ...createMockStockItem({ productId: 'p-1' }), PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p-1' }],
          LastEvaluatedKey: lastKey,
        })
        .mockResolvedValueOnce({
          Items: [{ ...createMockStockItem({ productId: 'p-2' }), PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p-2' }],
        });

      const result = await repository.getStockLevels('WAREHOUSE#wh-1');

      expect(result.map((r) => r.productId)).toEqual(['p-1', 'p-2']);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(sent(1).input.ExclusiveStartKey).toEqual(lastKey);
    });
  });

  /**
   * DynamoDB віддає ключі як UnprocessedKeys саме під тротлінгом, і SDK їх не
   * повторює (виклик успішний). Повтор — з паузою, що подвоюється, і з межею:
   * після неї запит падає 503, а не крутиться, доки ALB не обірве його.
   */
  describe('getProductQuantities', () => {
    const keys = ['WAREHOUSE#wh-1', 'CONTAINER#c-1'];

    it('asks again, after a pause, for the keys DynamoDB left unprocessed', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({
          Responses: { [INVENTORY_TABLE]: [{ PK: 'WAREHOUSE#wh-1', quantity: 4 }] },
          UnprocessedKeys: { [INVENTORY_TABLE]: { Keys: [{ PK: 'CONTAINER#c-1', SK: 'STOCK#prod-1' }] } },
        })
        .mockResolvedValueOnce({
          Responses: { [INVENTORY_TABLE]: [{ PK: 'CONTAINER#c-1', quantity: 2 }] },
        });

      const quantities = await repository.getProductQuantities('prod-1', keys);

      expect(quantities).toEqual(new Map([['WAREHOUSE#wh-1', 4], ['CONTAINER#c-1', 2]]));
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(sent(1).input.RequestItems[INVENTORY_TABLE].Keys).toEqual([
        { PK: 'CONTAINER#c-1', SK: 'STOCK#prod-1' },
      ]);
    });

    it('gives up after a bounded number of attempts instead of spinning', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Responses: { [INVENTORY_TABLE]: [] },
        UnprocessedKeys: { [INVENTORY_TABLE]: { Keys: [{ PK: 'CONTAINER#c-1', SK: 'STOCK#prod-1' }] } },
      });

      await expect(repository.getProductQuantities('prod-1', keys)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(5);
    });
  });

  /**
   * Шаблон фургона порівнюється з фургоном і складом: кожна пара (локація,
   * товар) — один ключ BatchGet, а не Query всього складу (тисячі рядків) і не
   * окремий виклик на кожен рядок шаблону.
   */
  describe('getQuantities', () => {
    it('reads every (location, product) pair in one batch and answers per location, per product', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Responses: {
          [INVENTORY_TABLE]: [
            { PK: 'CONTAINER#c-1', SK: 'STOCK#p-1', productId: 'p-1', quantity: 2 },
            { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p-2', quantity: 9 },
          ],
        },
      });

      const quantities = await repository.getQuantities(['CONTAINER#c-1', 'WAREHOUSE#wh-1'], ['p-1', 'p-2']);

      expect(sent(0).constructor.name).toBe('BatchGetCommand');
      expect(sent(0).input.RequestItems[INVENTORY_TABLE].Keys).toEqual([
        { PK: 'CONTAINER#c-1', SK: 'STOCK#p-1' },
        { PK: 'CONTAINER#c-1', SK: 'STOCK#p-2' },
        { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p-1' },
        { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p-2' },
      ]);
      expect(quantities.get('CONTAINER#c-1')).toEqual(new Map([['p-1', 2]]));
      // The product comes off the sort key when the row carries no productId.
      expect(quantities.get('WAREHOUSE#wh-1')).toEqual(new Map([['p-2', 9]]));
    });

    it('chunks at 100 keys and retries what DynamoDB left unprocessed', async () => {
      const products = Array.from({ length: 60 }, (_, i) => `p-${i}`);
      let deferred = false;
      dynamoDb.client.send.mockImplementation(async (command: any) => {
        const asked = command.input.RequestItems[INVENTORY_TABLE].Keys as Array<{ PK: string; SK: string }>;
        const first = asked.find((k) => k.PK === 'CONTAINER#c-1' && k.SK === 'STOCK#p-0');
        // The first chunk leaves CONTAINER#c-1 / p-0 behind once.
        if (first && asked.length === 100 && !deferred) {
          deferred = true;
          return { Responses: { [INVENTORY_TABLE]: [] }, UnprocessedKeys: { [INVENTORY_TABLE]: { Keys: [first] } } };
        }
        return {
          Responses: { [INVENTORY_TABLE]: first ? [{ PK: 'CONTAINER#c-1', SK: 'STOCK#p-0', quantity: 1 }] : [] },
        };
      });

      const quantities = await repository.getQuantities(['CONTAINER#c-1', 'WAREHOUSE#wh-1'], products);

      const sizes = dynamoDb.client.send.mock.calls.map((c) => c[0].input.RequestItems[INVENTORY_TABLE].Keys.length);
      expect(sizes.sort((a: number, b: number) => a - b)).toEqual([1, 20, 100]);
      expect(quantities.get('CONTAINER#c-1')?.get('p-0')).toBe(1);
    });

    it('reads nothing for no products', async () => {
      expect(await repository.getQuantities(['CONTAINER#c-1'], [])).toEqual(new Map());
      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });
  });

  /** A GetCommand answer for a stock row holding `quantity` (null: no row). */
  const storedRow = (quantity: number | null) =>
    quantity === null ? { Item: undefined } : { Item: { quantity } };

  /**
   * `onHand` на рядку товару — сума по всіх локаціях, яку список і картка
   * показують без BatchGet; `totalUnits` / `uniqueItems` на рядку локації —
   * те саме для списків складів і фургонів. Рядок STOCK#, підсумки локації
   * і `onHand` пишуться однією транзакцією: збій між окремими записами лишав
   * би сток зсунутим, а суми — старими, і жоден повтор цього не виправляв.
   */
  describe('incrementStock', () => {
    it('writes the stock row, the location totals and the product onHand in one transaction', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(sent().constructor.name).toBe('TransactWriteCommand');
      const [stock, location, product] = sent().input.TransactItems;
      expect(stock.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(stock.Update.UpdateExpression).toContain('ADD #quantity :qty');
      expect(stock.Update.ExpressionAttributeValues[':qty']).toBe(5);
      expect(stock.Update.ExpressionAttributeValues[':pid']).toBe('prod-1');
      expect(stock.Update.ExpressionAttributeValues[':pname']).toBe('Test Product');
      expect(location.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'METADATA' });
      expect(location.Update.UpdateExpression).toBe('ADD totalUnits :units');
      expect(location.Update.ExpressionAttributeValues).toEqual({ ':units': 5 });
      expect(product.Update.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(product.Update.UpdateExpression).toBe('ADD onHand :delta');
      expect(product.Update.ExpressionAttributeValues).toEqual({ ':delta': 5 });
    });

    // Перша спроба припускає, що товар на локації вже є: умова на рядку
    // STOCK# робить це припущення перевіреним, а не прочитаним заздалегідь.
    it('first assumes the location already holds the product, and says so in the stock condition', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      const [stock] = sent().input.TransactItems;
      expect(stock.Update.ConditionExpression).toBe('#quantity > :zero OR #quantity <= :negQty');
      expect(stock.Update.ExpressionAttributeValues).toMatchObject({ ':zero': 0, ':negQty': -5 });
    });

    it('counts a product the location did not hold: refused, reads the row, writes again with uniqueItems +1', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['ConditionalCheckFailed', 'None', 'None']))
        .mockResolvedValueOnce(storedRow(null))
        .mockResolvedValueOnce({});

      await repository.incrementStock('CONTAINER#c-1', 'prod-1', 'Test Product', 2);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
      expect(sent(1).constructor.name).toBe('GetCommand');
      expect(sent(1).input).toMatchObject({
        Key: { PK: 'CONTAINER#c-1', SK: 'STOCK#prod-1' },
        ConsistentRead: true,
      });
      const [stock, location, product] = sent(2).input.TransactItems;
      expect(stock.Update.ConditionExpression).toBe(
        'attribute_not_exists(#quantity) OR (#quantity <= :zero AND #quantity > :negQty)',
      );
      expect(location.Update.UpdateExpression).toBe('ADD totalUnits :units, uniqueItems :items');
      expect(location.Update.ExpressionAttributeValues).toEqual({ ':units': 2, ':items': 1 });
      expect(product.Update.ExpressionAttributeValues).toEqual({ ':delta': 2 });
    });

    it('counts a row that sat at zero the same way', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['ConditionalCheckFailed', 'None', 'None']))
        .mockResolvedValueOnce(storedRow(0))
        .mockResolvedValueOnce({});

      await repository.incrementStock('CONTAINER#c-1', 'prod-1', 'Test Product', 2);

      const [, location] = sent(2).input.TransactItems;
      expect(location.Update.ExpressionAttributeValues).toEqual({ ':units': 2, ':items': 1 });
    });

    // До бекфілу підсумків на локації нема; ADD створив би їх як дельту,
    // тож без атрибута вони не ведуться — як і `onHand` на товарі.
    it('moves the totals and onHand only where the rows exist and already carry them', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      const [, location, product] = sent().input.TransactItems;
      expect(location.Update.ConditionExpression).toBe('attribute_exists(PK) AND attribute_exists(totalUnits)');
      expect(product.Update.ConditionExpression).toBe('attribute_exists(PK) AND attribute_exists(onHand)');
    });

    it('leaves a location the backfill has not reached alone, and still moves the stock and onHand', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['None', 'ConditionalCheckFailed', 'None']))
        .mockResolvedValueOnce({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const items = sent(1).input.TransactItems;
      expect(items.map((i: any) => i.Update.Key)).toEqual([
        { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' },
        { PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      ]);
    });

    it('falls back to the stock row alone when the location and the product both refused', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(
          transactionCanceled(['None', 'ConditionalCheckFailed', 'ConditionalCheckFailed']),
        )
        .mockResolvedValueOnce({});

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'ghost', 'Ghost', 5),
      ).resolves.toBeUndefined();

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const items = sent(1).input.TransactItems;
      expect(items).toHaveLength(1);
      expect(items[0].Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#ghost' });
      expect(items[0].Update.UpdateExpression).toContain('ADD #quantity :qty');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:ghost');
    });

    it('propagates any other failure without touching the stock row again', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5),
      ).rejects.toThrow('Network error');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(redis.client.del).not.toHaveBeenCalled();
    });

    it('propagates a transaction cancelled for a reason no retry can fix', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(transactionCanceled(['ValidationError', 'None', 'None']));

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5),
      ).rejects.toThrow('Transaction cancelled');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    // Кожен запис стоку тепер торкається рядка METADATA локації, тож два
    // одночасні записи в один фургон можуть зіткнутися. Транзакція тоді не
    // застосована зовсім, і повтор безпечний.
    it('tries again after a transaction conflict — nothing of a cancelled transaction was applied', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['None', 'TransactionConflict', 'None']))
        .mockResolvedValueOnce({});

      await repository.incrementStock('CONTAINER#c-1', 'prod-1', 'Test Product', 1);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(sent(1).input.TransactItems).toHaveLength(3);
    });

    it('gives up with a 409 when the row keeps changing under it', async () => {
      dynamoDb.client.send.mockImplementation(async (command: any) => {
        if (command.constructor.name === 'GetCommand') return storedRow(4);
        throw transactionCanceled(['ConditionalCheckFailed', 'None', 'None']);
      });

      await expect(
        repository.incrementStock('CONTAINER#c-1', 'prod-1', 'Test Product', 1),
      ).rejects.toThrow(ConflictException);
    });

    it('drops the cached product so the next read sees the new onHand', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      expect(productCacheKey('prod-1')).toBe('inventory:product:prod-1');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:prod-1');
    });

    it('does not fail the stock write when Redis is down', async () => {
      dynamoDb.client.send.mockResolvedValue({});
      redis.client.del.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5),
      ).resolves.toBeUndefined();
    });

    it('works without Redis at all', async () => {
      const bare = new StockRepository(dynamoDb as any);
      dynamoDb.client.send.mockResolvedValue({});

      await expect(
        bare.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5),
      ).resolves.toBeUndefined();
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('decrementStock', () => {
    it('takes from the stock row, the location totals and onHand, in one transaction', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(sent().constructor.name).toBe('TransactWriteCommand');
      const [stock, location, product] = sent().input.TransactItems;
      expect(stock.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      // The first attempt assumes some are left behind.
      expect(stock.Update.ConditionExpression).toBe('#quantity > :qty');
      expect(stock.Update.ExpressionAttributeValues[':qty']).toBe(3);
      expect(location.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'METADATA' });
      expect(location.Update.ExpressionAttributeValues).toEqual({ ':units': -3 });
      expect(product.Update.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(product.Update.UpdateExpression).toBe('ADD onHand :delta');
      expect(product.Update.ExpressionAttributeValues).toEqual({ ':delta': -3 });
      expect(product.Update.ConditionExpression).toBe('attribute_exists(PK) AND attribute_exists(onHand)');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:prod-1');
    });

    it('emptying the row takes the product off uniqueItems', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['ConditionalCheckFailed', 'None', 'None']))
        .mockResolvedValueOnce(storedRow(3))
        .mockResolvedValueOnce({});

      await repository.decrementStock('CONTAINER#c-1', 'prod-1', 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
      const [stock, location] = sent(2).input.TransactItems;
      expect(stock.Update.ConditionExpression).toBe('#quantity = :qty');
      expect(location.Update.UpdateExpression).toBe('ADD totalUnits :units, uniqueItems :items');
      expect(location.Update.ExpressionAttributeValues).toEqual({ ':units': -3, ':items': -1 });
    });

    it('answers insufficient stock as a 400 once the row is read and holds too few', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['ConditionalCheckFailed', 'None', 'None']))
        .mockResolvedValueOnce(storedRow(2));

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3),
      ).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(redis.client.del).not.toHaveBeenCalled();
    });

    it('is insufficient stock when the location has no row for the product at all', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['ConditionalCheckFailed', 'None', 'None']))
        .mockResolvedValueOnce(storedRow(null));

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 1),
      ).rejects.toThrow('Insufficient stock for product prod-1');
    });

    it('is still insufficient stock when the other sides refused too', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(
          transactionCanceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']),
        )
        .mockResolvedValueOnce(storedRow(0));

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 100),
      ).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    });

    it('keeps the stock condition when only the product side refused', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['None', 'None', 'ConditionalCheckFailed']))
        .mockResolvedValueOnce({});

      await repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const items = sent(1).input.TransactItems;
      expect(items).toHaveLength(2);
      expect(items[0].Update.ConditionExpression).toBe('#quantity > :qty');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:prod-1');
    });

    it('should rethrow non-conditional errors', async () => {
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3),
      ).rejects.toThrow('Network error');
    });
  });

  /**
   * Переміщення між локаціями не змінює суму по товару: дві дельти взаємно
   * гасяться, тож `onHand` не чіпається. Обидва рядки STOCK# і підсумки обох
   * локацій — одна транзакція: жоден збій між списанням і зарахуванням не
   * лишає товар "у дорозі", а суми — розбіжними.
   */
  describe('moveStock', () => {
    it('moves between two stock rows and both locations\' totals in one transaction, leaving onHand alone', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 4);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(sent().constructor.name).toBe('TransactWriteCommand');
      const items = sent().input.TransactItems;
      expect(items).toHaveLength(4);
      const [from, to, fromTotals, toTotals] = items;
      expect(from.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(from.Update.ConditionExpression).toBe('#quantity > :qty');
      expect(from.Update.ExpressionAttributeValues[':qty']).toBe(4);
      expect(to.Update.Key).toEqual({ PK: 'CONTAINER#c-1', SK: 'STOCK#prod-1' });
      expect(to.Update.UpdateExpression).toContain('ADD #quantity :qty');
      expect(to.Update.ExpressionAttributeValues[':pname']).toBe('Test Product');
      expect(fromTotals.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'METADATA' });
      expect(fromTotals.Update.ExpressionAttributeValues).toEqual({ ':units': -4 });
      expect(toTotals.Update.Key).toEqual({ PK: 'CONTAINER#c-1', SK: 'METADATA' });
      expect(toTotals.Update.ExpressionAttributeValues).toEqual({ ':units': 4 });
      expect(items.some((i: any) => i.Update.Key.PK.startsWith('PRODUCT#'))).toBe(false);
      expect(redis.client.del).not.toHaveBeenCalled();
    });

    it('re-reads only the rows that refused, and moves each uniqueItems by what it found', async () => {
      // The warehouse gives its last 4, the van had none.
      dynamoDb.client.send
        .mockRejectedValueOnce(
          transactionCanceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'None', 'None']),
        )
        .mockImplementationOnce(async (cmd: any) => storedRow(cmd.input.Key.PK === 'WAREHOUSE#wh-1' ? 4 : null))
        .mockImplementationOnce(async (cmd: any) => storedRow(cmd.input.Key.PK === 'WAREHOUSE#wh-1' ? 4 : null))
        .mockResolvedValueOnce({});

      await repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 4);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(4);
      const [from, to, fromTotals, toTotals] = sent(3).input.TransactItems;
      expect(from.Update.ConditionExpression).toBe('#quantity = :qty');
      expect(to.Update.ConditionExpression).toContain('attribute_not_exists(#quantity)');
      expect(fromTotals.Update.ExpressionAttributeValues).toEqual({ ':units': -4, ':items': -1 });
      expect(toTotals.Update.ExpressionAttributeValues).toEqual({ ':units': 4, ':items': 1 });
    });

    it('answers insufficient stock as a 400 when the source cannot give the units', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['ConditionalCheckFailed', 'None', 'None', 'None']))
        .mockResolvedValueOnce(storedRow(1));

      await expect(
        repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('moves the stock even when neither location has totals yet', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(
          transactionCanceled(['None', 'None', 'ConditionalCheckFailed', 'ConditionalCheckFailed']),
        )
        .mockResolvedValueOnce({});

      await repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 1);

      expect(sent(1).input.TransactItems.map((i: any) => i.Update.Key.SK)).toEqual([
        'STOCK#prod-1',
        'STOCK#prod-1',
      ]);
    });

    it('propagates any other failure', async () => {
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(
        repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 1),
      ).rejects.toThrow('Network error');
    });
  });
});
