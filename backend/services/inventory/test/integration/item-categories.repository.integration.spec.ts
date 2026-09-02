import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type ProductCategory, type Product, ProductType, InventoryStatus } from '@bitcrm/types';
import { ItemCategoriesRepository } from 'src/item-categories/item-categories.repository';
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

describe('ItemCategoriesRepository (integration)', () => {
  let repository: ItemCategoriesRepository;
  let productsRepository: ProductsRepository;

  const makeCategory = (overrides?: Partial<ProductCategory>): ProductCategory => ({
    id: 'cat-1',
    name: 'Locks',
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  const makeProduct = (overrides?: Partial<Product>): Product => ({
    id: 'prod-1',
    sku: 'SKU-001',
    name: 'Deadbolt',
    category: 'Locks',
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 15,
    priceClient: 25,
    serialTracking: false,
    minimumStockLevel: 5,
    status: InventoryStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTable();
    const dbClient = getTestDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        ItemCategoriesRepository,
        ProductsRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(ItemCategoriesRepository);
    productsRepository = module.get(ProductsRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  it('create + get roundtrip', async () => {
    await repository.create(makeCategory());

    const found = await repository.get('cat-1');

    expect(found).toMatchObject({ id: 'cat-1', name: 'Locks', active: true });
  });

  it('listAll returns only catalog rows, sorted by the GSI sort key', async () => {
    await repository.create(makeCategory({ id: 'c1', name: 'Tools' }));
    await repository.create(makeCategory({ id: 'c2', name: 'keys' }));
    // A product row shares the table and GSI1 but a different partition.
    await productsRepository.create(makeProduct());

    const all = await repository.listAll();

    expect(all.map((c) => c.name)).toEqual(['keys', 'Tools']);
  });

  it('isReferencedByProduct: true when an item uses the category name', async () => {
    await productsRepository.create(makeProduct({ category: 'Locks' }));

    expect(await repository.isReferencedByProduct('Locks')).toBe(true);
    expect(await repository.isReferencedByProduct('Tools')).toBe(false);
  });

  it('remove deletes the row', async () => {
    await repository.create(makeCategory());
    await repository.remove('cat-1');

    expect(await repository.get('cat-1')).toBeNull();
  });

  it('create rejects a duplicate id', async () => {
    await repository.create(makeCategory());
    await expect(repository.create(makeCategory())).rejects.toThrow();
  });
});
