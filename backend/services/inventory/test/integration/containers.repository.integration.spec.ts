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
    name: 'Van 1',
    description: 'North route van',
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
      expect(found!.name).toBe('Van 1');
      expect(found!.description).toBe('North route van');
      expect(found!.technicianId).toBe('tech-1');
      expect(found!.technicianName).toBe('John Doe');
      expect(found!.department).toBe('HVAC');
      expect(found!.status).toBe(InventoryStatus.ACTIVE);
    });

    it('should persist an unassigned container', async () => {
      await repository.create(
        makeContainer({ technicianId: undefined, technicianName: undefined }),
      );

      const found = await repository.findById('ctr-1');

      expect(found!.name).toBe('Van 1');
      expect(found!.technicianId).toBeUndefined();
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

  describe('update assignment', () => {
    it('should reassign to another technician and move the GSI entry', async () => {
      await repository.create(makeContainer());

      await repository.update('ctr-1', {
        technicianId: 'tech-2',
        technicianName: 'Jane Smith',
      });

      const byOld = await repository.findByTechnicianId('tech-1');
      const byNew = await repository.findByTechnicianId('tech-2');
      expect(byOld).toBeNull();
      expect(byNew!.id).toBe('ctr-1');
      expect(byNew!.technicianName).toBe('Jane Smith');
    });

    it('should unassign with null and drop out of the technician index', async () => {
      await repository.create(makeContainer());

      const updated = await repository.update('ctr-1', {
        technicianId: null,
        technicianName: null,
      });

      expect(updated.technicianId).toBeUndefined();
      expect(updated.technicianName).toBeUndefined();
      expect(await repository.findByTechnicianId('tech-1')).toBeNull();
      // Still present by id and in the full list.
      expect((await repository.findById('ctr-1'))!.name).toBe('Van 1');
    });

    it('should update name and description', async () => {
      await repository.create(makeContainer());

      const updated = await repository.update('ctr-1', {
        name: 'Van 2',
        description: 'South route',
      });

      expect(updated.name).toBe('Van 2');
      expect(updated.description).toBe('South route');
    });
  });

  describe('legacy rows without a name', () => {
    it('should derive a name from the technician for pre-rename rows', async () => {
      // Simulate a row written before containers had their own name.
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      await dbClient.send(
        new PutCommand({
          TableName: 'BitCRM_Inventory_Test',
          Item: {
            PK: 'CONTAINER#legacy-1',
            SK: 'METADATA',
            GSI3PK: 'OWNER#tech-9',
            GSI3SK: 'CONTAINER#legacy-1',
            id: 'legacy-1',
            technicianId: 'tech-9',
            technicianName: 'Old Tech',
            department: 'HVAC',
            status: InventoryStatus.ACTIVE,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      );

      const found = await repository.findById('legacy-1');

      expect(found!.name).toBe("Old Tech's van");
    });
  });
});
