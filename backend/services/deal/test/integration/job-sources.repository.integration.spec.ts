import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type JobSource } from '@bitcrm/types';
import { JobSourcesRepository } from '../../src/job-sources/job-sources.repository';
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

function makeJobSource(overrides: Partial<JobSource> = {}): JobSource {
  return {
    id: 'jt-1',
    name: 'Google Ads',
    priority: 0,
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('JobSourcesRepository (integration)', () => {
  let repo: JobSourcesRepository;

  beforeAll(async () => {
    await createTestTables();
    const db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        JobSourcesRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(JobSourcesRepository);
  });

  afterAll(async () => clearTestTable(DEALS_TEST_TABLE));
  beforeEach(async () => clearTestTable(DEALS_TEST_TABLE));

  it('creates, reads, lists and removes job sources via the catalog GSI', async () => {
    await repo.create(makeJobSource({ id: 'a1', name: 'Alpha', priority: 1 }));
    await repo.create(makeJobSource({ id: 'a2', name: 'Bravo', priority: 2 }));

    expect(await repo.get('a1')).toMatchObject({ id: 'a1', name: 'Alpha' });
    const all = await repo.listAll();
    expect(all.map((a) => a.id).sort()).toEqual(['a1', 'a2']);

    await repo.remove('a1');
    expect(await repo.get('a1')).toBeNull();
    expect(await repo.listAll()).toHaveLength(1);
  });

  it('rejects a duplicate id on create', async () => {
    await repo.create(makeJobSource({ id: 'dup' }));
    await expect(repo.create(makeJobSource({ id: 'dup' }))).rejects.toThrow();
  });

  it('put replaces an existing job source', async () => {
    await repo.create(makeJobSource({ id: 'p1', name: 'Old' }));
    await repo.put(makeJobSource({ id: 'p1', name: 'New', priority: 9 }));
    expect(await repo.get('p1')).toMatchObject({ name: 'New', priority: 9 });
  });
});
