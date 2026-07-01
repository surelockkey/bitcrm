import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { TechnicianEligibilityRepository } from '../../src/technician-eligibility/technician-eligibility.repository';
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

describe('TechnicianEligibilityRepository (integration)', () => {
  let repo: TechnicianEligibilityRepository;
  let db: ReturnType<typeof getTestDynamoDbClient>;

  beforeAll(async () => {
    await createTestTables();
    db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        TechnicianEligibilityRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(TechnicianEligibilityRepository);
  });

  afterAll(async () => clearTestTable(DEALS_TEST_TABLE));
  beforeEach(async () => clearTestTable(DEALS_TEST_TABLE));

  it('upserts, reads, lists and removes eligibility', async () => {
    await repo.upsert({
      technicianId: 't1',
      approvedSkills: ['Locksmith'],
      serviceAreas: ['Atlanta'],
      assignable: true,
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    await repo.upsert({
      technicianId: 't2',
      approvedSkills: ['Rekeying'],
      serviceAreas: ['North GA'],
      assignable: true,
      updatedAt: '2026-06-30T00:00:00.000Z',
    });

    expect(await repo.get('t1')).toMatchObject({ technicianId: 't1', assignable: true });
    expect((await repo.listAll()).map((e) => e.technicianId).sort()).toEqual(['t1', 't2']);

    await repo.remove('t1');
    expect(await repo.get('t1')).toBeNull();
    expect(await repo.listAll()).toHaveLength(1);
  });
});
