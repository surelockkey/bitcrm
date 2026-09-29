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

  /**
   * What the jobs-list side-load reads to name the technicians of a page: one
   * BatchGet for the whole page rather than a Get per assigned id.
   */
  describe('getMany', () => {
    it('reads every id in one BatchGet on the eligibility keys', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Responses: {
          BitCRM_Deals: [
            { technicianId: 'tech-1', firstName: 'Ada', lastName: 'Lovelace', assignable: true },
            { technicianId: 'tech-2', firstName: 'Bo', lastName: 'Diaz', assignable: true },
          ],
        },
      });

      const out = await repo.getMany(['tech-1', 'tech-2']);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(dynamoDb.client.send.mock.calls[0][0].input.RequestItems.BitCRM_Deals.Keys).toEqual([
        { PK: 'TECH_ELIGIBILITY#tech-1', SK: 'ELIGIBILITY' },
        { PK: 'TECH_ELIGIBILITY#tech-2', SK: 'ELIGIBILITY' },
      ]);
      expect(out.map((r) => r.firstName)).toEqual(['Ada', 'Bo']);
    });

    it('dedupes, and asks for nothing when there is nothing to ask', async () => {
      dynamoDb.client.send.mockResolvedValue({ Responses: { BitCRM_Deals: [] } });

      expect(await repo.getMany([])).toEqual([]);
      expect(await repo.getMany(['', undefined as never])).toEqual([]);
      expect(dynamoDb.client.send).not.toHaveBeenCalled();

      await repo.getMany(['tech-1', 'tech-1']);
      expect(dynamoDb.client.send.mock.calls[0][0].input.RequestItems.BitCRM_Deals.Keys).toHaveLength(1);
    });

    it('caps the read — a page of jobs can never name more than 100 people', async () => {
      dynamoDb.client.send.mockResolvedValue({ Responses: { BitCRM_Deals: [] } });

      await repo.getMany(Array.from({ length: 130 }, (_, i) => `tech-${i}`));

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      expect(dynamoDb.client.send.mock.calls[0][0].input.RequestItems.BitCRM_Deals.Keys).toHaveLength(100);
    });

    it('an id with no projected row is simply absent', async () => {
      dynamoDb.client.send.mockResolvedValue({ Responses: { BitCRM_Deals: [] } });

      expect(await repo.getMany(['ghost'])).toEqual([]);
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
