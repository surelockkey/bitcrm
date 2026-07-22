import { JobSourcesRepository } from 'src/job-sources/job-sources.repository';
import { createMockDynamoDbService, createMockJobSource } from '../mocks';

describe('JobSourcesRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: JobSourcesRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new JobSourcesRepository(dynamoDb as any);
  });

  it('writes catalog keys on create', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockJobSource({ id: 'jt-1', name: 'Referral', priority: 5 }));

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('JOB_SOURCE#jt-1');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.GSI1PK).toBe('CATALOG#JOB_SOURCE');
    expect(input.Item.GSI1SK).toBe('000005#referral');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('reads by id', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockJobSource({ id: 'jt-2' }) } });
    const jobSource = await repository.get('jt-2');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'JOB_SOURCE#jt-2', SK: 'METADATA' });
    expect(jobSource?.id).toBe('jt-2');
  });

  it('returns null when a job source is missing', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repository.get('missing')).toBeNull();
  });

  it('lists all job sources via the catalog GSI', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [createMockJobSource()] });
    const jobSources = await repository.listAll();

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StageIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe('CATALOG#JOB_SOURCE');
    expect(jobSources).toHaveLength(1);
  });

  it('detects a job source still referenced by a deal', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [{ id: 'deal-1' }] });
    expect(await repository.isReferencedByDeal('jt-1')).toBe(true);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#sourceId = :id');
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
    expect(input.Key).toEqual({ PK: 'JOB_SOURCE#jt-3', SK: 'METADATA' });
  });
});
