import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type TechnicianProfile } from '@bitcrm/types';
import { TechniciansRepository } from '../../src/technicians/technicians.repository';
import {
  createTestTable,
  clearTestTable,
  getTestDynamoDbClient,
} from './setup';

// Point the repository at the test table.
jest.mock('../../src/technicians/constants/dynamo.constants', () => ({
  TECHNICIANS_TABLE: 'BitCRM_Users_Test',
  GSI3_NAME: 'TechnicianIndex',
  TECHNICIAN_GSI_PK: 'TECHNICIAN',
  PROFILE_SK: 'TECH_PROFILE',
}));

describe('TechniciansRepository (integration)', () => {
  let repository: TechniciansRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const makeProfile = (
    overrides?: Partial<TechnicianProfile>,
  ): TechnicianProfile => ({
    userId: 'tech-1',
    phone: '404-555-0123',
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTable();
    dbClient = getTestDynamoDbClient();
    const module = await Test.createTestingModule({
      providers: [
        TechniciansRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();
    repository = module.get(TechniciansRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  it('upserts and reads back a profile', async () => {
    await repository.upsertProfile(makeProfile());
    const found = await repository.getProfile('tech-1');
    expect(found).toMatchObject({ userId: 'tech-1', phone: '404-555-0123', status: 'pending' });
  });

  it('returns null for a missing profile', async () => {
    expect(await repository.getProfile('ghost')).toBeNull();
  });

  it('updates fields and moves the item across the status index', async () => {
    await repository.upsertProfile(makeProfile({ status: 'pending' }));
    const updated = await repository.updateProfile('tech-1', {
      status: 'active',
      laborCostPerHour: 45,
    });
    expect(updated.status).toBe('active');
    expect(updated.laborCostPerHour).toBe(45);

    const pending = await repository.listByStatus('pending', 20);
    const active = await repository.listByStatus('active', 20);
    expect(pending.items).toHaveLength(0);
    expect(active.items.map((p) => p.userId)).toContain('tech-1');
  });

  it('lists all technicians via the TechnicianIndex', async () => {
    await repository.upsertProfile(makeProfile({ userId: 'tech-1', status: 'active' }));
    await repository.upsertProfile(makeProfile({ userId: 'tech-2', status: 'pending' }));
    const all = await repository.listAll(20);
    expect(all.items.map((p) => p.userId).sort()).toEqual(['tech-1', 'tech-2']);
  });

  it('rejects updates to a non-existent profile', async () => {
    await expect(
      repository.updateProfile('ghost', { phone: '000' }),
    ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
  });
});
