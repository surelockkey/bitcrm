import { ClientTagsRepository } from 'src/client-tags/client-tags.repository';
import { createMockDynamoDbService, createMockClientTag } from '../mocks';

describe('ClientTagsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ClientTagsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ClientTagsRepository(dynamoDb as any);
  });

  it('writes catalog keys on create', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockClientTag({ id: 'jt-1', name: 'Repeat', priority: 5 }));

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('CLIENT_TAG#jt-1');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.GSI1PK).toBe('CATALOG#CLIENT_TAG');
    expect(input.Item.GSI1SK).toBe('000005#repeat');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('reads by id', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockClientTag({ id: 'jt-2' }) } });
    const clientTag = await repository.get('jt-2');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'CLIENT_TAG#jt-2', SK: 'METADATA' });
    expect(clientTag?.id).toBe('jt-2');
  });

  it('returns null when a client tag is missing', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repository.get('missing')).toBeNull();
  });

  it('lists all client tags via the catalog GSI', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [createMockClientTag()] });
    const clientTags = await repository.listAll();

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StageIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe('CATALOG#CLIENT_TAG');
    expect(clientTags).toHaveLength(1);
  });


  it('deletes by id', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.remove('jt-3');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'CLIENT_TAG#jt-3', SK: 'METADATA' });
  });
});
