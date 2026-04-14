import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { DynamoDbService } from '@bitcrm/shared';
import { ProductsRepository } from 'src/products/products.repository';
import { createMockProduct, createMockDynamoDbService } from '../mocks';

describe('ProductsRepository', () => {
  let repository: ProductsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsRepository,
        { provide: DynamoDbService, useValue: dynamoDb },
      ],
    }).compile();

    repository = module.get<ProductsRepository>(ProductsRepository);
  });

  describe('create', () => {
    it('should send TransactWriteCommand to create product and SKU lookup', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(product);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException on TransactionCanceledException', async () => {
      const product = createMockProduct();
      const error = new Error('Transaction cancelled');
      error.name = 'TransactionCanceledException';
      dynamoDb.client.send.mockRejectedValue(error);

      await expect(repository.create(product)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should rethrow non-transaction errors', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(repository.create(product)).rejects.toThrow('Network error');
    });
  });

  describe('findById', () => {
    it('should return product when found', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Item: { ...product, PK: `PRODUCT#${product.id}`, SK: 'METADATA' },
      });

      const result = await repository.findById('prod-1');

      expect(result).toBeDefined();
      expect(result!.id).toBe('prod-1');
    });

    it('should return null when not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findBySku', () => {
    it('should query SKU lookup then get product', async () => {
      const product = createMockProduct();
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [{ productId: 'prod-1' }] })
        .mockResolvedValueOnce({
          Item: { ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
        });

      const result = await repository.findBySku('SKU-001');

      expect(result).toBeDefined();
      expect(result!.id).toBe('prod-1');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    });

    it('should return null if SKU lookup yields no items', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      const result = await repository.findBySku('NONEXISTENT');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findAll(20);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should return nextCursor when there are more results', async () => {
      const product = createMockProduct();
      const lastKey = { PK: 'PRODUCT#prod-1', SK: 'METADATA' };
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: lastKey,
      });

      const result = await repository.findAll(1);

      expect(result.nextCursor).toBeDefined();
    });
  });

  describe('findByCategory', () => {
    it('should query GSI1 with category', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByCategory('Locks', 20);

      expect(result.items).toHaveLength(1);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByType', () => {
    it('should query GSI2 with type', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByType('product', 20);

      expect(result.items).toHaveLength(1);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should build correct SET expression and return updated product', async () => {
      const updated = createMockProduct({ name: 'Updated Product' });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      const result = await repository.update('prod-1', { name: 'Updated Product' });

      expect(result.name).toBe('Updated Product');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('should rebuild GSI keys when category changes', async () => {
      const updated = createMockProduct({ category: 'Safes' });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      const result = await repository.update('prod-1', { category: 'Safes' });

      expect(result.category).toBe('Safes');
      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      // Verify GSI1PK is included in the update expression values
      expect(JSON.stringify(input.ExpressionAttributeValues)).toContain('CATEGORY#Safes');
    });

    it('should rebuild GSI keys when type changes', async () => {
      const updated = createMockProduct({ type: 'service' as any });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      const result = await repository.update('prod-1', { type: 'service' as any });

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      expect(JSON.stringify(input.ExpressionAttributeValues)).toContain('TYPE#service');
    });

    it('should skip immutable keys (id, sku)', async () => {
      const updated = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      await repository.update('prod-1', { id: 'new-id', sku: 'NEW-SKU', name: 'Updated' } as any);

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const expressionNames = sendCall.input.ExpressionAttributeNames;
      expect(expressionNames).not.toHaveProperty('#id');
      expect(expressionNames).not.toHaveProperty('#sku');
    });
  });
});
