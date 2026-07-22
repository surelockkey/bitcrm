import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type JobType } from '@bitcrm/types';
import { JobTypesRepository } from '../../src/job-types/job-types.repository';
import {
  createTestTables,
  clearTestTable,
  getTestDynamoDbClient,
  DEALS_TEST_TABLE,
} from './setup';

jest.mock('../../src/common/constants/dynamo.constants', () => ({
  DEALS_TABLE: 'BitCRM_Deals_Test',
  DEALS_GSI1_NAME: 'StageIndex',
  DEALS_GSI2_NAME: 'TechIndex',
  DEALS_GSI3_NAME: 'ContactIndex',
  DEALS_GSI4_NAME: 'DispatcherIndex',
}));

function makeJobType(overrides: Partial<JobType> = {}): JobType {
  return {
    id: 'jt-1',
    name: 'Lockout',
    priority: 0,
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('JobTypesRepository (integration)', () => {
  let repo: JobTypesRepository;

  beforeAll(async () => {
    await createTestTables();
    const db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        JobTypesRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(JobTypesRepository);
  });

  afterAll(async () => clearTestTable(DEALS_TEST_TABLE));
  beforeEach(async () => clearTestTable(DEALS_TEST_TABLE));

  it('creates, reads, lists and removes job types via the catalog GSI', async () => {
    await repo.create(makeJobType({ id: 'a1', name: 'Alpha', priority: 1 }));
    await repo.create(makeJobType({ id: 'a2', name: 'Bravo', priority: 2 }));

    expect(await repo.get('a1')).toMatchObject({ id: 'a1', name: 'Alpha' });
    const all = await repo.listAll();
    expect(all.map((a) => a.id).sort()).toEqual(['a1', 'a2']);

    await repo.remove('a1');
    expect(await repo.get('a1')).toBeNull();
    expect(await repo.listAll()).toHaveLength(1);
  });

  it('rejects a duplicate id on create', async () => {
    await repo.create(makeJobType({ id: 'dup' }));
    await expect(repo.create(makeJobType({ id: 'dup' }))).rejects.toThrow();
  });

  it('put replaces an existing job type', async () => {
    await repo.create(makeJobType({ id: 'p1', name: 'Old' }));
    await repo.put(makeJobType({ id: 'p1', name: 'New', priority: 9 }));
    expect(await repo.get('p1')).toMatchObject({ name: 'New', priority: 9 });
  });
});
