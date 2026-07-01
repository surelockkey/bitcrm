import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type CommissionConfig } from '@bitcrm/types';
import { CommissionRepository } from '../../src/technicians/commission/commission.repository';
import { createTestTable, clearTestTable, getTestDynamoDbClient } from './setup';

jest.mock('../../src/technicians/constants/dynamo.constants', () => ({
  TECHNICIANS_TABLE: 'BitCRM_Users_Test',
  COMMISSION_SK_PREFIX: 'COMMISSION#',
}));

describe('CommissionRepository (integration)', () => {
  let repo: CommissionRepository;
  let db: ReturnType<typeof getTestDynamoDbClient>;

  const cfg = (o?: Partial<CommissionConfig>): CommissionConfig => ({
    userId: 'tech-1',
    baseRatePct: 40,
    creditCardFeePct: 3,
    achFeePct: 0,
    effectiveDate: '2026-01-01T00:00:00.000Z',
    createdBy: 'mgr-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...o,
  });

  beforeAll(async () => {
    await createTestTable();
    db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        CommissionRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(CommissionRepository);
  });

  afterAll(async () => clearTestTable());
  beforeEach(async () => clearTestTable());

  it('returns null when no config exists', async () => {
    expect(await repo.getLatest('tech-1')).toBeNull();
  });

  it('keeps versions and resolves the latest by effective date', async () => {
    await repo.create(cfg({ effectiveDate: '2026-01-01T00:00:00.000Z', baseRatePct: 40 }));
    await repo.create(cfg({ effectiveDate: '2026-06-01T00:00:00.000Z', baseRatePct: 45 }));

    const latest = await repo.getLatest('tech-1');
    expect(latest?.baseRatePct).toBe(45);

    const history = await repo.listHistory('tech-1');
    expect(history.map((h) => h.baseRatePct)).toEqual([45, 40]); // newest first
  });
});
