import { TechnicianEligibilityRepository } from '../../../src/technician-eligibility/technician-eligibility.repository';
import { createMockDynamoDbService } from '../mocks';

describe('TechnicianEligibilityRepository (unit)', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repo: TechnicianEligibilityRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repo = new TechnicianEligibilityRepository(dynamoDb as never);
  });

  it('upsert writes a TECH_ELIGIBILITY# item', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repo.upsert({
      technicianId: 'tech-1',
      jobTypeIds: ['jt-1'],
      serviceAreaIds: ['sa-1'],
      assignable: true,
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe('TECH_ELIGIBILITY#tech-1');
    expect(item.SK).toBe('ELIGIBILITY');
    expect(item.assignable).toBe(true);
  });

  it('get returns null when absent', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repo.get('tech-1')).toBeNull();
  });

  it('remove deletes the item', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repo.remove('tech-1');
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
      PK: 'TECH_ELIGIBILITY#tech-1',
      SK: 'ELIGIBILITY',
    });
  });

  it('listAll scans the eligibility partition prefix', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [{ technicianId: 'tech-1', assignable: true }] });
    const out = await repo.listAll();
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('begins_with(PK, :pk)');
    expect(input.ExpressionAttributeValues[':pk']).toBe('TECH_ELIGIBILITY#');
    expect(out).toHaveLength(1);
  });

  /**
   * The Scan's 1MB budget is spent on deals — the rows this filter throws away
   * — long before the eligibility partition is exhausted, so page one can hold
   * almost none of it. What the picker offers and what the boot reconcile can
   * remove are both exactly this list.
   */
  it('listAll follows LastEvaluatedKey to the end of the table', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({
        Items: [{ technicianId: 'tech-1', assignable: true }],
        LastEvaluatedKey: { PK: 'DEAL#999', SK: 'METADATA' },
      })
      .mockResolvedValueOnce({
        Items: [{ technicianId: 'test-tech-ct-3', assignable: true }],
      });

    const out = await repo.listAll();

    expect(out.map((r) => r.technicianId)).toEqual(['tech-1', 'test-tech-ct-3']);
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
      PK: 'DEAL#999',
      SK: 'METADATA',
    });
  });
});
