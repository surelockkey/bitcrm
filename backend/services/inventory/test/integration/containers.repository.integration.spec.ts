import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type Container, InventoryStatus } from '@bitcrm/types';
import { ContainersRepository } from 'src/containers/containers.repository';
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

describe('ContainersRepository (integration)', () => {
  let repository: ContainersRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const makeContainer = (overrides?: Partial<Container>): Container => ({
    id: 'ctr-1',
    technicianId: 'tech-1',
    technicianName: 'John Doe',
    department: 'HVAC',
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
        ContainersRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(ContainersRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a container', async () => {
      const container = makeContainer();
      await repository.create(container);

      const found = await repository.findById('ctr-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('ctr-1');
      expect(found!.technicianId).toBe('tech-1');
      expect(found!.technicianName).toBe('John Doe');
      expect(found!.department).toBe('HVAC');
      expect(found!.status).toBe(InventoryStatus.ACTIVE);
    });
  });

  describe('findById', () => {
    it('should return null for nonexistent container', async () => {
      const result = await repository.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByTechnicianId (GSI3)', () => {
    it('should return container for technician', async () => {
      await repository.create(makeContainer({ id: 'ctr-1', technicianId: 'tech-1' }));
      await repository.create(makeContainer({ id: 'ctr-2', technicianId: 'tech-2', technicianName: 'Jane Smith' }));

      const found = await repository.findByTechnicianId('tech-1');

      expect(found).not.toBeNull();
      expect(found!.technicianId).toBe('tech-1');
    });

    it('should return null for nonexistent technician', async () => {
      const found = await repository.findByTechnicianId('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findAll with department filter', () => {
    it('should filter by department', async () => {
      await repository.create(makeContainer({ id: 'ctr-1', technicianId: 'tech-1', department: 'HVAC' }));
      await repository.create(makeContainer({ id: 'ctr-2', technicianId: 'tech-2', department: 'Plumbing', technicianName: 'Jane' }));

      const hvac = await repository.findAll(1000, undefined, { department: 'HVAC' });
      const plumbing = await repository.findAll(1000, undefined, { department: 'Plumbing' });

      expect(hvac.items.every((c) => c.department === 'HVAC')).toBe(true);
      expect(plumbing.items.every((c) => c.department === 'Plumbing')).toBe(true);
    });

    it('should return all containers without filter', async () => {
      await repository.create(makeContainer({ id: 'ctr-1', technicianId: 'tech-1' }));
      await repository.create(makeContainer({ id: 'ctr-2', technicianId: 'tech-2', technicianName: 'Jane' }));

      // Use large limit — DynamoDB Scan applies Limit BEFORE FilterExpression
      const result = await repository.findAll(1000);

      expect(result.items.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('create duplicate', () => {
    it('should throw on duplicate container ID', async () => {
      await repository.create(makeContainer());

      await expect(
        repository.create(makeContainer()),
      ).rejects.toThrow();
    });
  });
});
