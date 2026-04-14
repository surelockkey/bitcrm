import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DynamoDbService } from '@bitcrm/shared';
import { StockRepository } from 'src/stock/stock.repository';
import { createMockStockItem, createMockDynamoDbService } from '../mocks';

describe('StockRepository', () => {
  let repository: StockRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockRepository,
        { provide: DynamoDbService, useValue: dynamoDb },
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

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      expect(input.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(input.UpdateExpression).toContain('ADD');
      expect(input.ExpressionAttributeValues[':qty']).toBe(5);
      expect(input.ExpressionAttributeValues[':pid']).toBe('prod-1');
      expect(input.ExpressionAttributeValues[':pname']).toBe('Test Product');
    });
  });

  describe('decrementStock', () => {
    it('should send UpdateCommand with condition check', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.decrementStock('WAREHOUSE#wh-1', 'prod-1', 3);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      expect(input.Key).toEqual({ PK: 'WAREHOUSE#wh-1', SK: 'STOCK#prod-1' });
      expect(input.ConditionExpression).toContain('#quantity >= :qty');
      expect(input.ExpressionAttributeValues[':qty']).toBe(3);
    });

    it('should throw BadRequestException on ConditionalCheckFailedException', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockRejectedValue(error);

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
});
