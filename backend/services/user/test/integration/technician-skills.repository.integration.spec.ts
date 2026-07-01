import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type TechnicianSkill } from '@bitcrm/types';
import { TechnicianSkillsRepository } from '../../src/technicians/skills/technician-skills.repository';
import { createTestTable, clearTestTable, getTestDynamoDbClient } from './setup';

jest.mock('../../src/technicians/constants/dynamo.constants', () => ({
  TECHNICIANS_TABLE: 'BitCRM_Users_Test',
  GSI4_NAME: 'SkillStatusIndex',
  SKILL_SK_PREFIX: 'SKILL#',
  skillStatusGsiPk: (s: string) => `SKILL_STATUS#${s}`,
}));

describe('TechnicianSkillsRepository (integration)', () => {
  let repo: TechnicianSkillsRepository;
  let db: ReturnType<typeof getTestDynamoDbClient>;

  const skill = (o?: Partial<TechnicianSkill>): TechnicianSkill => ({
    skillId: 'sk-1',
    userId: 'tech-1',
    type: 'job_type',
    value: 'Locksmith',
    status: 'pending',
    proposedBy: 'tech-1',
    proposedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  });

  beforeAll(async () => {
    await createTestTable();
    db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        TechnicianSkillsRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(TechnicianSkillsRepository);
  });

  afterAll(async () => clearTestTable());
  beforeEach(async () => clearTestTable());

  it('creates and lists skills for a user', async () => {
    await repo.create(skill({ skillId: 's1', value: 'Locksmith' }));
    await repo.create(skill({ skillId: 's2', type: 'service_area', value: 'Atlanta' }));
    const all = await repo.listByUser('tech-1');
    expect(all.map((s) => s.value).sort()).toEqual(['Atlanta', 'Locksmith']);
  });

  it('moves a skill across the SkillStatusIndex on approval', async () => {
    await repo.create(skill({ skillId: 's1', status: 'pending' }));
    await repo.create(skill({ skillId: 's2', userId: 'tech-2', status: 'pending' }));

    const pendingBefore = await repo.listPendingAcrossTechs(20);
    expect(pendingBefore.items).toHaveLength(2);

    await repo.updateStatus('tech-1', 's1', {
      status: 'approved',
      reviewedBy: 'mgr-1',
      reviewedAt: '2026-02-01T00:00:00.000Z',
    });

    const pendingAfter = await repo.listPendingAcrossTechs(20);
    expect(pendingAfter.items.map((s) => s.userId)).toEqual(['tech-2']);
  });

  it('deletes (revokes) a skill', async () => {
    await repo.create(skill({ skillId: 's1' }));
    await repo.delete('tech-1', 's1');
    expect(await repo.getById('tech-1', 's1')).toBeNull();
  });
});
