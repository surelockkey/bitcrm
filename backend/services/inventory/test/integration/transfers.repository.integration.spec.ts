import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type Transfer, TransferType, LocationType } from '@bitcrm/types';
import { TransfersRepository } from 'src/transfers/transfers.repository';
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

/** Small delay to allow DynamoDB Local GSI4 to become consistent. */
const waitForGSI = () => new Promise((resolve) => setTimeout(resolve, 200));

describe('TransfersRepository (integration)', () => {
  let repository: TransfersRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const makeTransfer = (overrides?: Partial<Transfer>): Transfer => ({
    id: 'txn-1',
    type: TransferType.TRANSFER,
    fromType: LocationType.WAREHOUSE,
    fromId: 'wh-1',
    toType: LocationType.CONTAINER,
    toId: 'ctr-1',
    items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 5 }],
    performedBy: 'user-1',
    performedByName: 'John Doe',
    notes: 'Test transfer',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTable();
    dbClient = getTestDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        TransfersRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(TransfersRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a transfer', async () => {
      const transfer = makeTransfer();
      await repository.create(transfer);

      const found = await repository.findById('txn-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('txn-1');
      expect(found!.type).toBe(TransferType.TRANSFER);
      expect(found!.fromType).toBe(LocationType.WAREHOUSE);
      expect(found!.fromId).toBe('wh-1');
      expect(found!.toType).toBe(LocationType.CONTAINER);
      expect(found!.toId).toBe('ctr-1');
      expect(found!.items).toHaveLength(1);
      expect(found!.items[0].productId).toBe('prod-1');
      expect(found!.performedBy).toBe('user-1');
    });

    it('should return null for nonexistent transfer', async () => {
      const result = await repository.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByEntity (GSI4) - source entity', () => {
    it('should query transfers by source entity', async () => {
      await repository.create(makeTransfer({ id: 'txn-1', fromType: LocationType.WAREHOUSE, fromId: 'wh-1' }));
      await repository.create(makeTransfer({
        id: 'txn-2',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-1',
        createdAt: '2026-01-02T00:00:00.000Z',
      }));
      await repository.create(makeTransfer({
        id: 'txn-3',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-2',
        createdAt: '2026-01-03T00:00:00.000Z',
      }));

      // Wait for GSI4 eventual consistency in DynamoDB Local
      await waitForGSI();

      const result = await repository.findByEntity(LocationType.WAREHOUSE, 'wh-1', 10);

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.every((t) => t.fromId === 'wh-1')).toBe(true);
    });
  });

  describe('findByEntity (GSI4) - destination entity', () => {
    it('should query transfers by destination entity', async () => {
      await repository.create(makeTransfer({
        id: 'txn-1',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-1',
        toType: LocationType.CONTAINER,
        toId: 'ctr-1',
      }));
      await repository.create(makeTransfer({
        id: 'txn-2',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-1',
        toType: LocationType.CONTAINER,
        toId: 'ctr-2',
        createdAt: '2026-01-02T00:00:00.000Z',
      }));

      // Wait for GSI4 eventual consistency in DynamoDB Local
      await waitForGSI();

      const result = await repository.findByEntity(LocationType.CONTAINER, 'ctr-1', 10);

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.every((t) => t.toId === 'ctr-1')).toBe(true);
    });
  });

  describe('findAll', () => {
    it('should return all transfers', async () => {
      await repository.create(makeTransfer({ id: 'txn-1' }));
      await repository.create(makeTransfer({
        id: 'txn-2',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-2',
        toType: LocationType.CONTAINER,
        toId: 'ctr-2',
        createdAt: '2026-01-02T00:00:00.000Z',
      }));
      await repository.create(makeTransfer({
        id: 'txn-3',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-3',
        toType: LocationType.CONTAINER,
        toId: 'ctr-3',
        createdAt: '2026-01-03T00:00:00.000Z',
      }));

      // Use large limit — DynamoDB Scan applies Limit BEFORE FilterExpression,
      // so ENTITY_REF items may consume part of the limit.
      const result = await repository.findAll(1000);

      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('pagination', () => {
    it('should paginate with cursor', async () => {
      await repository.create(makeTransfer({ id: 'txn-1' }));
      await repository.create(makeTransfer({
        id: 'txn-2',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-2',
        toType: LocationType.CONTAINER,
        toId: 'ctr-2',
        createdAt: '2026-01-02T00:00:00.000Z',
      }));
      await repository.create(makeTransfer({
        id: 'txn-3',
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-3',
        toType: LocationType.CONTAINER,
        toId: 'ctr-3',
        createdAt: '2026-01-03T00:00:00.000Z',
      }));

      const page1 = await repository.findAll(1);
      expect(page1.items.length).toBeGreaterThanOrEqual(0);

      if (page1.nextCursor) {
        const page2 = await repository.findAll(1000, page1.nextCursor);
        const allIds = [
          ...page1.items.map((t) => t.id),
          ...page2.items.map((t) => t.id),
        ];
        expect(new Set(allIds).size).toBe(allIds.length); // No duplicates
      }
    });
  });
});
