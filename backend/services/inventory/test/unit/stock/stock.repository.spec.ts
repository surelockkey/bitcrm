import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DynamoDbService, RedisService } from '@bitcrm/shared';
import { StockRepository } from 'src/stock/stock.repository';
import { productCacheKey } from 'src/products/products-cache.service';
import {
  createMockStockItem,
  createMockDynamoDbService,
  createMockRedisService,
} from '../mocks';

describe('StockRepository', () => {
  let repository: StockRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let redis: ReturnType<typeof createMockRedisService>;

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
  });

  describe('incrementStock', () => {
    it('should send UpdateCommand with ADD', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      expect(input.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(input.UpdateExpression).toContain('ADD');
      expect(input.ExpressionAttributeValues[':qty']).toBe(5);
      expect(input.ExpressionAttributeValues[':pid']).toBe('prod-1');
      expect(input.ExpressionAttributeValues[':pname']).toBe('Test Product');
    });

    /**
     * `onHand` на рядку товару — сума по всіх локаціях, яку список і картка
     * показують без BatchGet. Її веде кожен рух запасу: після рядка STOCK#
     * — ADD на PRODUCT#, лише якщо товар у каталозі є.
     */
    it('then ADDs the quantity to the product row onHand, only if the product exists', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const onHand = dynamoDb.client.send.mock.calls[1][0].input;
      expect(onHand.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(onHand.UpdateExpression).toBe('ADD onHand :delta');
      expect(onHand.ExpressionAttributeValues).toEqual({ ':delta': 5 });
      expect(onHand.ConditionExpression).toBe('attribute_exists(PK)');
    });

    it('shrugs off a product the catalog never persisted', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockResolvedValueOnce({}).mockRejectedValueOnce(error);

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'ghost', 'Ghost', 5),
      ).resolves.toBeUndefined();
    });

    it('propagates any other failure of the onHand write', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Network error'));

      await expect(
        repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5),
      ).rejects.toThrow('Network error');
    });

    it('drops the cached product so the next read sees the new onHand', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Test Product', 5);

      expect(productCacheKey('prod-1')).toBe('inventory:product:prod-1');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:prod-1');
    });

    it('drops the cache even when the product row was missing (the cache may still hold it)', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockResolvedValueOnce({}).mockRejectedValueOnce(error);

      await repository.incrementStock('WAREHOUSE#wh-1', 'ghost', 'Ghost', 5);

      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:ghost');
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
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('decrementStock', () => {
    it('should send UpdateCommand with condition check', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3);

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      expect(input.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(input.ConditionExpression).toContain('#quantity >= :qty');
      expect(input.ExpressionAttributeValues[':qty']).toBe(3);
    });

    it('subtracts from the product row onHand once the stock row shrank', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const onHand = dynamoDb.client.send.mock.calls[1][0].input;
      expect(onHand.Key).toEqual({ PK: 'PRODUCT#prod-1', SK: 'METADATA' });
      expect(onHand.UpdateExpression).toBe('ADD onHand :delta');
      expect(onHand.ExpressionAttributeValues).toEqual({ ':delta': -3 });
      expect(onHand.ConditionExpression).toBe('attribute_exists(PK)');
      expect(redis.client.del).toHaveBeenCalledWith('inventory:product:prod-1');
    });

    it('should throw BadRequestException on ConditionalCheckFailedException', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockRejectedValue(error);

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 100),
      ).rejects.toThrow(BadRequestException);
    });

    it('leaves onHand alone when the stock row refused', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockRejectedValue(error);

      await expect(repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 100)).rejects.toThrow();

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(redis.client.del).not.toHaveBeenCalled();
    });

    it('should rethrow non-conditional errors', async () => {
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(
        repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3),
      ).rejects.toThrow('Network error');
    });
  });
});
