import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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
      dynamoDb.client.send
        .mockResolvedValueOnce({
          Responses: { [INVENTORY_TABLE]: [] },
          UnprocessedKeys: { [INVENTORY_TABLE]: { Keys: [{ PK: 'CONTAINER#c-1', SK: 'STOCK#p-0' }] } },
        })
        .mockResolvedValueOnce({
          Responses: { [INVENTORY_TABLE]: [{ PK: 'CONTAINER#c-1', SK: 'STOCK#p-0', quantity: 1 }] },
        })
        .mockResolvedValueOnce({ Responses: { [INVENTORY_TABLE]: [] } });

      const quantities = await repository.getQuantities(['CONTAINER#c-1', 'WAREHOUSE#wh-1'], products);

      const sizes = dynamoDb.client.send.mock.calls.map((c) => c[0].input.RequestItems[INVENTORY_TABLE].Keys.length);
      expect(sizes).toEqual([100, 1, 20]);
      expect(quantities.get('CONTAINER#c-1')?.get('p-0')).toBe(1);
    });

    it('reads nothing for no products', async () => {
      expect(await repository.getQuantities(['CONTAINER#c-1'], [])).toEqual(new Map());
      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });
  });

  /**
   * `onHand` на рядку товару — сума по всіх локаціях, яку список і картка
   * показують без BatchGet. Рядок STOCK# і `onHand` пишуться однією
   * транзакцією: збій між двома окремими записами лишав би сток зсунутим, а
   * суму — старою, і жоден повтор цього не виправляв.
   */
  describe('incrementStock', () => {
    it('writes the stock row and the product onHand in one transaction', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(sent().constructor.name).toBe('TransactWriteCommand');
      const [stock, product] = sent().input.TransactItems;
      expect(stock.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(stock.Update.UpdateExpression).toContain('ADD #quantity :qty');
      expect(stock.Update.ExpressionAttributeValues[':qty']).toBe(5);
      expect(stock.Update.ExpressionAttributeValues[':pid']).toBe('prod-1');
      expect(stock.Update.ExpressionAttributeValues[':pname']).toBe('Test Product');
      expect(product.Update.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(product.Update.UpdateExpression).toBe('ADD onHand :delta');
      expect(product.Update.ExpressionAttributeValues).toEqual({ ':delta': 5 });
    });

    // До бекфілу `onHand` на товарі нема; ADD створив би його як дельту (-2
    // після списання двох із десяти), тож без атрибута сума не ведеться.
    it('moves onHand only where the product row exists and already carries one', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      const [, product] = sent().input.TransactItems;
      expect(product.Update.ConditionExpression).toBe('attribute_exists(PK) AND attribute_exists(onHand)');
    });

    it('falls back to the stock row alone when only the product side refused', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['None', 'ConditionalCheckFailed']))
        .mockResolvedValueOnce({});

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'ghost', 'Ghost', 5),
      ).resolves.toBeUndefined();

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(sent(1).constructor.name).toBe('UpdateCommand');
      expect(sent(1).input.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#ghost' });
      expect(sent(1).input.UpdateExpression).toContain('ADD #quantity :qty');
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

    it('propagates a transaction cancelled for any reason but the product condition', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(transactionCanceled(['TransactionConflict', 'None']));

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5),
      ).rejects.toThrow('Transaction cancelled');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
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
    it('subtracts from the stock row under its condition and from onHand, in one transaction', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(sent().constructor.name).toBe('TransactWriteCommand');
      const [stock, product] = sent().input.TransactItems;
      expect(stock.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(stock.Update.ConditionExpression).toContain('#quantity >= :qty');
      expect(stock.Update.ExpressionAttributeValues[':qty']).toBe(3);
      expect(product.Update.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(product.Update.UpdateExpression).toBe('ADD onHand :delta');
      expect(product.Update.ExpressionAttributeValues).toEqual({ ':delta': -3 });
      expect(product.Update.ConditionExpression).toBe('attribute_exists(PK) AND attribute_exists(onHand)');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:prod-1');
    });

    it('answers insufficient stock as a 400 when the stock row refused', async () => {
      dynamoDb.client.send.mockRejectedValue(transactionCanceled(['ConditionalCheckFailed', 'None']));

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 100),
      ).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(redis.client.del).not.toHaveBeenCalled();
    });

    it('is still insufficient stock when both sides refused', async () => {
      dynamoDb.client.send.mockRejectedValue(
        transactionCanceled(['ConditionalCheckFailed', 'ConditionalCheckFailed']),
      );

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 100),
      ).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('falls back to the conditional stock write alone when only the product side refused', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['None', 'ConditionalCheckFailed']))
        .mockResolvedValueOnce({});

      await repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(sent(1).constructor.name).toBe('UpdateCommand');
      expect(sent(1).input.ConditionExpression).toContain('#quantity >= :qty');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:prod-1');
    });

    it('turns a refused fallback into insufficient stock too', async () => {
      const refused = new Error('Condition not met');
      refused.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send
        .mockRejectedValueOnce(transactionCanceled(['None', 'ConditionalCheckFailed']))
        .mockRejectedValueOnce(refused);

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 100),
      ).rejects.toThrow(BadRequestException);
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
   * гасяться, тож транзакція несе лише два рядки STOCK# — і жоден збій між
   * списанням і зарахуванням не лишає товар "у дорозі".
   */
  describe('moveStock', () => {
    it('moves between two stock rows in one transaction, leaving onHand alone', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 4);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(sent().constructor.name).toBe('TransactWriteCommand');
      const items = sent().input.TransactItems;
      expect(items).toHaveLength(2);
      const [from, to] = items;
      expect(from.Update.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(from.Update.ConditionExpression).toContain('#quantity >= :qty');
      expect(from.Update.ExpressionAttributeValues[':qty']).toBe(4);
      expect(to.Update.Key).toEqual({ PK: 'CONTAINER#c-1', SK: 'STOCK#prod-1' });
      expect(to.Update.UpdateExpression).toContain('ADD #quantity :qty');
      expect(to.Update.ExpressionAttributeValues[':pname']).toBe('Test Product');
      expect(redis.client.del).not.toHaveBeenCalled();
    });

    it('answers insufficient stock as a 400 when the source refused', async () => {
      dynamoDb.client.send.mockRejectedValue(transactionCanceled(['ConditionalCheckFailed', 'None']));

      await expect(
        repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates any other failure', async () => {
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(
        repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Test Product', 1),
      ).rejects.toThrow('Network error');
    });
  });
});
