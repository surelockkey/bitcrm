import { JobTypesRepository } from 'src/job-types/job-types.repository';
import { createMockDynamoDbService, createMockJobType } from '../mocks';

describe('JobTypesRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: JobTypesRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new JobTypesRepository(dynamoDb as any);
  });

  it('writes catalog keys on create', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockJobType({ id: 'jt-1', name: 'Rekey', priority: 5 }));

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('JOB_TYPE#jt-1');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.GSI1PK).toBe('CATALOG#JOB_TYPE');
    expect(input.Item.GSI1SK).toBe('000005#rekey');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('reads by id', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockJobType({ id: 'jt-2' }) } });
    const jobType = await repository.get('jt-2');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'JOB_TYPE#jt-2', SK: 'METADATA' });
    expect(jobType?.id).toBe('jt-2');
  });

  it('returns null when a job type is missing', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repository.get('missing')).toBeNull();
  });

  it('lists all job types via the catalog GSI', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [createMockJobType()] });
    const jobTypes = await repository.listAll();

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StageIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe('CATALOG#JOB_TYPE');
    expect(jobTypes).toHaveLength(1);
  });

  it('detects a job type still referenced by a deal', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [{ id: 'deal-1' }] });
    expect(await repository.isReferencedByDeal('jt-1')).toBe(true);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#jobTypeId = :id');
    expect(input.ExpressionAttributeValues[':id']).toBe('jt-1');
  });

  it('reports no reference when the scan is empty', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    expect(await repository.isReferencedByDeal('jt-1')).toBe(false);
  });

  it('deletes by id', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.remove('jt-3');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'JOB_TYPE#jt-3', SK: 'METADATA' });
  });
});
