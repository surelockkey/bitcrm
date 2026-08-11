import { Test } from '@nestjs/testing';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { JobSuperStatus, type DealSubStatus } from '@bitcrm/types';
import { JobStatusesRepository } from '../../src/job-statuses/job-statuses.repository';
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

function makeStatus(overrides: Partial<DealSubStatus> = {}): DealSubStatus {
  return {
    id: 'js-1',
    name: 'Will Call Back',
    group: JobSuperStatus.PENDING,
    color: 'red',
    priority: 0,
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('JobStatusesRepository (integration)', () => {
  let repo: JobStatusesRepository;

  beforeAll(async () => {
    await createTestTables();
    const db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        JobStatusesRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(JobStatusesRepository);
  });

  afterAll(async () => clearTestTable(DEALS_TEST_TABLE));
  beforeEach(async () => clearTestTable(DEALS_TEST_TABLE));

  it('creates, reads, lists and removes job statuses via the catalog GSI', async () => {
    await repo.create(makeStatus({ id: 'a1', name: 'Alpha', priority: 1 }));
    await repo.create(makeStatus({ id: 'a2', name: 'Bravo', priority: 2 }));

    expect(await repo.get('a1')).toMatchObject({ id: 'a1', name: 'Alpha', group: JobSuperStatus.PENDING });
    const all = await repo.listAll();
    expect(all.map((a) => a.id).sort()).toEqual(['a1', 'a2']);

    await repo.remove('a1');
    expect(await repo.get('a1')).toBeNull();
    expect(await repo.listAll()).toHaveLength(1);
  });

  it('rejects a duplicate id on create', async () => {
    await repo.create(makeStatus({ id: 'dup' }));
    await expect(repo.create(makeStatus({ id: 'dup' }))).rejects.toThrow();
  });

  it('put replaces an existing job status', async () => {
    await repo.create(makeStatus({ id: 'p1', name: 'Old' }));
    await repo.put(makeStatus({ id: 'p1', name: 'New', priority: 9, group: JobSuperStatus.DONE }));
    expect(await repo.get('p1')).toMatchObject({ name: 'New', priority: 9, group: JobSuperStatus.DONE });
  });

  it('detects whether a deal references the status (scalar subStatusId match)', async () => {
    const db = getTestDynamoDbClient();
    await repo.create(makeStatus({ id: 's1' }));
    // A deal row carrying the sub-status; only the fields the scan reads matter.
    await db.send(new PutCommand({
      TableName: 'BitCRM_Deals_Test',
      Item: { PK: 'DEAL#d1', SK: 'METADATA', subStatusId: 's1' },
    }));

    expect(await repo.isReferencedByDeal('s1')).toBe(true);
    expect(await repo.isReferencedByDeal('nope')).toBe(false);
  });
});
