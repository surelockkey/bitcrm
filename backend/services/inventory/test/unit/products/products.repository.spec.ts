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

    it('REMOVEs a key handed in as an explicit undefined', async () => {
      // The contract the CSV re-import relies on to clear a stale workizType.
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockProduct(), PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      await repository.update('prod-1', { workizType: undefined, name: 'Kept' });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('REMOVE #workizType');
      expect(input.UpdateExpression).toContain('#name = :name');
      expect(input.ExpressionAttributeValues).not.toHaveProperty(':workizType');
    });
  });
  /**
   * The Workiz importer writes attributes `Product` does not declare and, for
   * 10 items, a type BitCRM has no enum value for. Both must survive a read:
   * `update` writes only the fields it is given, so anything the mapper drops
   * is erased on the first edit from the UI.
   */
  describe('toProduct (imported rows)', () => {
    const importedRow = {
      PK: 'PRODUCT#prod-1',
      SK: 'METADATA',
      GSI1PK: 'CATEGORY#Uncategorized',
      GSI1SK: 'PRODUCT#prod-1',
      GSI2PK: 'TYPE#service',
      GSI2SK: 'PRODUCT#prod-1',
      id: 'prod-1',
      sku: 'WZ-10707',
      name: 'Trip charge',
      category: 'Uncategorized',
      type: 'service',
      costCompany: 0,
      costTech: 0,
      priceClient: -35,
      serialTracking: false,
      minimumStockLevel: 0,
      status: 'active',
      createdAt: '2021-03-04T00:00:00.000Z',
      updatedAt: '2021-03-04T00:00:00.000Z',
      externalId: 'workiz:item:10707',
      taxable: true,
      manageStock: false,
      customAttributes: { 'In Store Location': 'Shelf 3' },
      workizFileId: '33144326',
    };

    const read = async (over: Record<string, unknown> = {}) => {
      dynamoDb.client.send.mockResolvedValue({ Item: { ...importedRow, ...over } });
      return (await repository.findById('prod-1')) as unknown as Record<string, unknown>;
    };

    it('carries the importer attributes onto the entity', async () => {
      const product = await read();

      expect(product).toMatchObject({
        externalId: 'workiz:item:10707',
        taxable: true,
        manageStock: false,
        workizFileId: '33144326',
        customAttributes: { 'In Store Location': 'Shelf 3' },
      });
    });

    it('never leaks the DynamoDB key attributes', async () => {
      const product = await read();

      for (const key of ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK']) {
        expect(product[key]).toBeUndefined();
      }
    });

    /**
     * The whole commit rests on `toProduct` spreading the stored row FIRST and
     * writing the typed fields over it. That order is only observable where
     * the typed read path produces something different from what is stored —
     * `type` is that place (an unknown word is normalised to `service`). If
     * `...extras` were spread last, or the typed fields moved above it, the
     * raw `other` would win here and every `assertStockable` / TypeIndex
     * consumer would see a value `ProductType` has no member for.
     */
    it('lets the typed fields win over the colliding stored value', async () => {
      const product = await read({ type: 'other', taxable: 'yes-from-workiz' });

      // Typed field beats the stored one it collides with…
      expect(product.type).toBe('service');
      expect(product.type).not.toBe('other');
      // …while an attribute with no typed counterpart is still carried through
      // (so the fix is the order, not dropping the spread).
      expect(product.taxable).toBe('yes-from-workiz');
      expect(product.workizType).toBe('other');
    });

    it("maps a Workiz 'other' type to service and keeps the word", async () => {
      const product = await read({ type: 'other' });

      expect(product.type).toBe('service');
      expect(product.workizType).toBe('other');
    });

    it("maps a Workiz 'hours' type to service and keeps the word", async () => {
      const product = await read({ type: 'hours' });

      expect(product.type).toBe('service');
      expect(product.workizType).toBe('hours');
    });

    it('prefers an explicit workizType the importer already wrote', async () => {
      const product = await read({ type: 'service', workizType: 'hours' });

      expect(product.type).toBe('service');
      expect(product.workizType).toBe('hours');
    });

    it('leaves workizType off a normal product', async () => {
      const product = await read({ type: 'product' });

      expect(product.type).toBe('product');
      expect('workizType' in product).toBe(false);
    });

    it('leaves a row with no type untyped so the boot backfill still heals it', async () => {
      const { type: _dropped, ...noType } = importedRow;
      dynamoDb.client.send.mockResolvedValue({ Item: noType });

      const product = await repository.findById('prod-1');

      expect(product!.type).toBeUndefined();
    });
  });
});
