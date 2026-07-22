import { JobTagsRepository } from 'src/job-tags/job-tags.repository';
import { createMockDynamoDbService, createMockJobTag } from '../mocks';

describe('JobTagsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: JobTagsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new JobTagsRepository(dynamoDb as any);
  });

  it('writes catalog keys on create', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockJobTag({ id: 'jt-1', name: 'Repeat', priority: 5 }));

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('JOB_TAG#jt-1');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.GSI1PK).toBe('CATALOG#JOB_TAG');
    expect(input.Item.GSI1SK).toBe('000005#repeat');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('reads by id', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockJobTag({ id: 'jt-2' }) } });
    const jobTag = await repository.get('jt-2');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'JOB_TAG#jt-2', SK: 'METADATA' });
    expect(jobTag?.id).toBe('jt-2');
  });

  it('returns null when a job tag is missing', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repository.get('missing')).toBeNull();
  });

  it('lists all job tags via the catalog GSI', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [createMockJobTag()] });
    const jobTags = await repository.listAll();

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StageIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe('CATALOG#JOB_TAG');
    expect(jobTags).toHaveLength(1);
  });

  it('detects a job tag still referenced by a deal', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [{ id: 'deal-1' }] });
    expect(await repository.isReferencedByDeal('jt-1')).toBe(true);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('contains(#tagIds, :id)');
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
    expect(input.Key).toEqual({ PK: 'JOB_TAG#jt-3', SK: 'METADATA' });
  });
});
