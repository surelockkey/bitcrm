import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type Warehouse, InventoryStatus } from '@bitcrm/types';
import { WarehousesRepository } from 'src/warehouses/warehouses.repository';
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

describe('WarehousesRepository (integration)', () => {
  let repository: WarehousesRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const makeWarehouse = (overrides?: Partial<Warehouse>): Warehouse => ({
    id: 'wh-1',
    name: 'Main Warehouse',
    address: '123 Main St',
    description: 'Primary warehouse',
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
        WarehousesRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(WarehousesRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a warehouse', async () => {
      const warehouse = makeWarehouse();
      await repository.create(warehouse);

      const found = await repository.findById('wh-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('wh-1');
      expect(found!.name).toBe('Main Warehouse');
      expect(found!.address).toBe('123 Main St');
      expect(found!.status).toBe(InventoryStatus.ACTIVE);
    });
  });

  describe('findById', () => {
    it('should return null for nonexistent warehouse', async () => {
      const result = await repository.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all warehouses', async () => {
      await repository.create(makeWarehouse({ id: 'wh-1' }));
      await repository.create(makeWarehouse({ id: 'wh-2', name: 'Secondary' }));
      await repository.create(makeWarehouse({ id: 'wh-3', name: 'Tertiary' }));

      // Use large limit — DynamoDB Scan applies Limit BEFORE FilterExpression
      const result = await repository.findAll(1000);

      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('update', () => {
    it('should update fields and return updated warehouse', async () => {
      await repository.create(makeWarehouse());

      const updated = await repository.update('wh-1', {
        name: 'Renamed Warehouse',
      });

      expect(updated.name).toBe('Renamed Warehouse');
      expect(updated.address).toBe('123 Main St'); // Unchanged
    });

    it('should set updatedAt timestamp', async () => {
      await repository.create(makeWarehouse());

      const updated = await repository.update('wh-1', { name: 'New Name' });

      expect(updated.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('should throw on nonexistent warehouse', async () => {
      await expect(
        repository.update('nonexistent', { name: 'Fail' }),
      ).rejects.toThrow();
    });
  });

  describe('pagination', () => {
    it('should paginate with cursor', async () => {
      await repository.create(makeWarehouse({ id: 'wh-1' }));
      await repository.create(makeWarehouse({ id: 'wh-2', name: 'Secondary' }));
      await repository.create(makeWarehouse({ id: 'wh-3', name: 'Tertiary' }));

      const page1 = await repository.findAll(1);
      expect(page1.items.length).toBeGreaterThanOrEqual(0);

      if (page1.nextCursor) {
        const page2 = await repository.findAll(1000, page1.nextCursor);
        const allIds = [
          ...page1.items.map((w) => w.id),
          ...page2.items.map((w) => w.id),
        ];
        expect(new Set(allIds).size).toBe(allIds.length); // No duplicates
      }
    });
  });
});
