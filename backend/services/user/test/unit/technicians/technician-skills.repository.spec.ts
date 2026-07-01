import { type TechnicianSkill } from '@bitcrm/types';
import { TechnicianSkillsRepository } from '../../../src/technicians/skills/technician-skills.repository';
import { createMockDynamoDbClient } from '../mocks';

function skill(overrides?: Partial<TechnicianSkill>): TechnicianSkill {
  return {
    skillId: 'sk-1',
    userId: 'tech-1',
    type: 'job_type',
    value: 'Locksmith',
    status: 'pending',
    proposedBy: 'tech-1',
    proposedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TechnicianSkillsRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: TechnicianSkillsRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new TechnicianSkillsRepository({ client } as never);
  });

  it('create writes SKILL# item with SkillStatusIndex keys', async () => {
    client.send.mockResolvedValue({});
    await repo.create(skill());
    const item = client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe('USER#tech-1');
    expect(item.SK).toBe('SKILL#sk-1');
    expect(item.GSI4PK).toBe('SKILL_STATUS#pending');
    expect(item.GSI4SK).toBe('tech-1#sk-1');
  });

  it('listByUser queries the SKILL# sort-key prefix', async () => {
    client.send.mockResolvedValue({ Items: [skill()] });
    const result = await repo.listByUser('tech-1');
    const input = client.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toContain('begins_with(SK, :sk)');
    expect(input.ExpressionAttributeValues[':pk']).toBe('USER#tech-1');
    expect(input.ExpressionAttributeValues[':sk']).toBe('SKILL#');
    expect(result).toHaveLength(1);
  });

  it('listPendingAcrossTechs queries SkillStatusIndex by status partition', async () => {
    client.send.mockResolvedValue({ Items: [skill()], LastEvaluatedKey: undefined });
    const result = await repo.listPendingAcrossTechs(20);
    const input = client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('SkillStatusIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe('SKILL_STATUS#pending');
    expect(result.items).toHaveLength(1);
  });

  it('updateStatus rebuilds GSI4PK to the new status and sets review fields', async () => {
    client.send.mockResolvedValue({ Attributes: skill({ status: 'approved' }) });
    await repo.updateStatus('tech-1', 'sk-1', {
      status: 'approved',
      reviewedBy: 'mgr-1',
      reviewedAt: '2026-02-01T00:00:00.000Z',
      comments: 'verified',
    });
    const input = client.send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues[':GSI4PK']).toBe('SKILL_STATUS#approved');
    expect(input.UpdateExpression).toContain('#GSI4PK = :GSI4PK');
    expect(input.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('delete removes the SKILL# item', async () => {
    client.send.mockResolvedValue({});
    await repo.delete('tech-1', 'sk-1');
    const input = client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'USER#tech-1', SK: 'SKILL#sk-1' });
  });
});
