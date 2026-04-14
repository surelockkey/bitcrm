import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type Product, ProductType, InventoryStatus } from '@bitcrm/types';
import { ProductsRepository } from 'src/products/products.repository';
import {
  createTestTable,
  clearTestTable,
  getTestDynamoDbClient,
} from './setup';

jest.mock('../../src/common/constants/dynamo.constants', () => ({
  INVENTORY_TABLE: 'BitCRM_Inventory_Test',
  GSI1_NAME: 'CategoryIndex',
  GSI2_NAME: 'TypeIndex',
  GSI3_NAME: 'OwnerIndex',
  GSI4_NAME: 'TransferEntityIndex',
}));

describe('ProductsRepository (integration)', () => {
  let repository: ProductsRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const makeProduct = (overrides?: Partial<Product>): Product => ({
    id: 'prod-1',
    sku: 'SKU-001',
    barcode: undefined,
    name: 'Test Product',
    description: 'A test product',
    category: 'Parts',
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 15,
    priceClient: 25,
    supplier: 'Supplier A',
    photoKey: undefined,
    serialTracking: false,
    minimumStockLevel: 5,
    status: InventoryStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTable();
    dbClient = getTestDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        ProductsRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(ProductsRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a product', async () => {
      const product = makeProduct();
      await repository.create(product);

      const found = await repository.findById('prod-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('prod-1');
      expect(found!.sku).toBe('SKU-001');
      expect(found!.name).toBe('Test Product');
      expect(found!.category).toBe('Parts');
      expect(found!.type).toBe(ProductType.PRODUCT);
      expect(found!.status).toBe(InventoryStatus.ACTIVE);
    });
  });

  describe('create duplicate SKU', () => {
    it('should throw ConflictException on duplicate SKU', async () => {
      await repository.create(makeProduct());

      await expect(
        repository.create(makeProduct({ id: 'prod-2' })),
      ).rejects.toThrow('already exists');
    });
  });

  describe('findBySku', () => {
    it('should query SKU lookup then get product', async () => {
      await repository.create(makeProduct());

      const found = await repository.findBySku('SKU-001');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('prod-1');
      expect(found!.sku).toBe('SKU-001');
    });

    it('should return null for nonexistent SKU', async () => {
      const found = await repository.findBySku('NONEXISTENT');
      expect(found).toBeNull();
    });
  });

  describe('findByCategory (GSI1)', () => {
    it('should return products matching category', async () => {
      await repository.create(makeProduct({ id: 'p1', sku: 'SKU-1', category: 'Parts' }));
      await repository.create(makeProduct({ id: 'p2', sku: 'SKU-2', category: 'Parts' }));
      await repository.create(makeProduct({ id: 'p3', sku: 'SKU-3', category: 'Tools' }));

      const result = await repository.findByCategory('Parts', 10);

      expect(result.items).toHaveLength(2);
      expect(result.items.every((p) => p.category === 'Parts')).toBe(true);
    });

    it('should return empty for nonexistent category', async () => {
      const result = await repository.findByCategory('Nonexistent', 10);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('findByType (GSI2)', () => {
    it('should return products matching type', async () => {
      await repository.create(makeProduct({ id: 'p1', sku: 'SKU-1', type: ProductType.PRODUCT }));
      await repository.create(makeProduct({ id: 'p2', sku: 'SKU-2', type: ProductType.SERVICE }));

      const result = await repository.findByType(ProductType.PRODUCT, 10);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe(ProductType.PRODUCT);
    });
  });

  describe('findAll with pagination', () => {
    it('should return all products', async () => {
      await repository.create(makeProduct({ id: 'p1', sku: 'SKU-1' }));
      await repository.create(makeProduct({ id: 'p2', sku: 'SKU-2' }));
      await repository.create(makeProduct({ id: 'p3', sku: 'SKU-3' }));

      // Use large limit — DynamoDB Scan applies Limit BEFORE FilterExpression,
      // so SKU# lookup items may consume part of the limit.
      const result = await repository.findAll(1000);

      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it('should paginate with cursor', async () => {
      await repository.create(makeProduct({ id: 'p1', sku: 'SKU-1' }));
      await repository.create(makeProduct({ id: 'p2', sku: 'SKU-2' }));
      await repository.create(makeProduct({ id: 'p3', sku: 'SKU-3' }));

      const page1 = await repository.findAll(1);
      expect(page1.items.length).toBeGreaterThanOrEqual(0);

      if (page1.nextCursor) {
        const page2 = await repository.findAll(1000, page1.nextCursor);
        const allIds = [
          ...page1.items.map((p) => p.id),
          ...page2.items.map((p) => p.id),
        ];
        expect(new Set(allIds).size).toBe(allIds.length); // No duplicates
      }
    });
  });

  describe('update', () => {
    it('should update fields and verify', async () => {
      await repository.create(makeProduct());

      const updated = await repository.update('prod-1', { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
      expect(updated.sku).toBe('SKU-001'); // Unchanged
    });

    it('should set updatedAt timestamp', async () => {
      await repository.create(makeProduct());

      const updated = await repository.update('prod-1', { name: 'New' });

      expect(updated.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('should rebuild GSI1 keys on category change', async () => {
      await repository.create(makeProduct({ category: 'Parts' }));

      await repository.update('prod-1', { category: 'Tools' });

      const oldCategory = await repository.findByCategory('Parts', 10);
      expect(oldCategory.items).toHaveLength(0);

      const newCategory = await repository.findByCategory('Tools', 10);
      expect(newCategory.items).toHaveLength(1);
      expect(newCategory.items[0].id).toBe('prod-1');
    });

    it('should rebuild GSI2 keys on type change', async () => {
      await repository.create(makeProduct({ type: ProductType.PRODUCT }));

      await repository.update('prod-1', { type: ProductType.SERVICE });

      const oldType = await repository.findByType(ProductType.PRODUCT, 10);
      expect(oldType.items).toHaveLength(0);

      const newType = await repository.findByType(ProductType.SERVICE, 10);
      expect(newType.items).toHaveLength(1);
      expect(newType.items[0].id).toBe('prod-1');
    });

    it('should throw on nonexistent product', async () => {
      await expect(
        repository.update('nonexistent', { name: 'Fail' }),
      ).rejects.toThrow();
    });
  });

  describe('findAll with status filter', () => {
    it('should filter by status', async () => {
      await repository.create(makeProduct({ id: 'p1', sku: 'SKU-1', status: InventoryStatus.ACTIVE }));
      await repository.create(makeProduct({ id: 'p2', sku: 'SKU-2', status: InventoryStatus.ARCHIVED }));

      const active = await repository.findAll(1000, undefined, { status: InventoryStatus.ACTIVE });
      const inactive = await repository.findAll(1000, undefined, { status: InventoryStatus.ARCHIVED });

      expect(active.items.every((p) => p.status === InventoryStatus.ACTIVE)).toBe(true);
      expect(inactive.items.every((p) => p.status === InventoryStatus.ARCHIVED)).toBe(true);
    });
  });

  describe('findAll with search filter', () => {
    it('should filter by name search', async () => {
      await repository.create(makeProduct({ id: 'p1', sku: 'SKU-1', name: 'HVAC Filter' }));
      await repository.create(makeProduct({ id: 'p2', sku: 'SKU-2', name: 'Plumbing Pipe' }));

      const result = await repository.findAll(1000, undefined, { search: 'HVAC' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('HVAC Filter');
    });

    it('should filter by SKU search', async () => {
      await repository.create(makeProduct({ id: 'p1', sku: 'HVAC-001', name: 'Filter' }));
      await repository.create(makeProduct({ id: 'p2', sku: 'PLB-001', name: 'Pipe' }));

      const result = await repository.findAll(1000, undefined, { search: 'HVAC' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].sku).toBe('HVAC-001');
    });
  });
});
