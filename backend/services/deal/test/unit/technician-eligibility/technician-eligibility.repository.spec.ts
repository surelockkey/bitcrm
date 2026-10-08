import { TechnicianEligibilityRepository } from '../../../src/technician-eligibility/technician-eligibility.repository';
import { createMockDynamoDbService } from '../mocks';

describe('TechnicianEligibilityRepository (unit)', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repo: TechnicianEligibilityRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repo = new TechnicianEligibilityRepository(dynamoDb as never);
  });

  /**
   * Every technician lives in ONE partition, so the whole roster is a Query.
   * Each used to be its own `TECH_ELIGIBILITY#<id>` partition, which left a
   * Scan of the entire deals table as the only way to list them — five
   * seconds on dev, growing with every imported job, on every job page.
   */
  it('upsert writes the item into the one eligibility partition', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repo.upsert({
      technicianId: 'tech-1',
      jobTypeIds: ['jt-1'],
      serviceAreaIds: ['sa-1'],
      assignable: true,
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe('TECH_ELIGIBILITY');
    expect(item.SK).toBe('TECH#tech-1');
    expect(item.assignable).toBe(true);
  });

  it('reads the Workiz name back, and leaves it absent on a row without one', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: { technicianId: 'tech-1', assignable: true, firstName: 'Daniel', workizName: '(2) TX - Daniel Munoz' },
    });
    expect((await repo.get('tech-1'))?.workizName).toBe('(2) TX - Daniel Munoz');

    dynamoDb.client.send.mockResolvedValue({ Item: { technicianId: 'tech-1', assignable: true } });
    expect(await repo.get('tech-1')).not.toHaveProperty('workizName');
  });

  it('get returns null when absent', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repo.get('tech-1')).toBeNull();
  });

  it('remove deletes the item', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repo.remove('tech-1');
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
      PK: 'TECH_ELIGIBILITY',
      SK: 'TECH#tech-1',
    });
  });

  it('get reads the item by its key in the eligibility partition', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { technicianId: 'tech-1', assignable: true } });
    expect(await repo.get('tech-1')).toMatchObject({ technicianId: 'tech-1' });
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
      PK: 'TECH_ELIGIBILITY',
      SK: 'TECH#tech-1',
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
        { PK: 'TECH_ELIGIBILITY', SK: 'TECH#tech-1' },
        { PK: 'TECH_ELIGIBILITY', SK: 'TECH#tech-2' },
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

  it('listAll queries the one eligibility partition — never a Scan', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [{ technicianId: 'tech-1', assignable: true }] });
    const out = await repo.listAll();
    const command = dynamoDb.client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('QueryCommand');
    expect(command.input.KeyConditionExpression).toBe('PK = :pk');
    expect(command.input.ExpressionAttributeValues[':pk']).toBe('TECH_ELIGIBILITY');
    expect(out).toHaveLength(1);
  });

  /** A Query page tops out at 1MB too; the picker must still see everyone. */
  it('listAll follows LastEvaluatedKey to the end of the partition', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({
        Items: [{ technicianId: 'tech-1', assignable: true }],
        LastEvaluatedKey: { PK: 'TECH_ELIGIBILITY', SK: 'TECH#tech-1' },
      })
      .mockResolvedValueOnce({
        Items: [{ technicianId: 'tech-2', assignable: true }],
      });

    const out = await repo.listAll();

    expect(out.map((r) => r.technicianId)).toEqual(['tech-1', 'tech-2']);
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
      PK: 'TECH_ELIGIBILITY',
      SK: 'TECH#tech-1',
    });
  });

  /**
   * The rows written before the move: one `TECH_ELIGIBILITY#<id>` partition
   * each. Only the boot migration reads them, and only while the new
   * partition is still empty — so this Scan runs once per environment.
   */
  describe('the pre-move layout', () => {
    it('listLegacy scans for the old per-technician partitions, to the end of the table', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({
          Items: [{ technicianId: 'tech-1', assignable: true }],
          LastEvaluatedKey: { PK: 'DEAL#999', SK: 'METADATA' },
        })
        .mockResolvedValueOnce({ Items: [{ technicianId: 'tech-2', assignable: true }] });

      const out = await repo.listLegacy();

      const first = dynamoDb.client.send.mock.calls[0][0].input;
      expect(first.FilterExpression).toBe('begins_with(PK, :pk)');
      expect(first.ExpressionAttributeValues[':pk']).toBe('TECH_ELIGIBILITY#');
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
        PK: 'DEAL#999',
        SK: 'METADATA',
      });
      expect(out.map((r) => r.technicianId)).toEqual(['tech-1', 'tech-2']);
    });

    it('removeLegacy deletes the old-layout row', async () => {
      dynamoDb.client.send.mockResolvedValue({});
      await repo.removeLegacy('tech-1');
      expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
        PK: 'TECH_ELIGIBILITY#tech-1',
        SK: 'ELIGIBILITY',
      });
    });
  });
});
