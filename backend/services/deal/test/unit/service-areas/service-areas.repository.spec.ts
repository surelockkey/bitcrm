import { ServiceAreasRepository } from 'src/service-areas/service-areas.repository';
import { createMockDynamoDbService, createMockServiceArea } from '../mocks';

describe('ServiceAreasRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ServiceAreasRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ServiceAreasRepository(dynamoDb as any);
  });

  it('writes catalog keys on create', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockServiceArea({ id: 'a-1', name: 'North', priority: 5 }));

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('SERVICE_AREA#a-1');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.GSI1PK).toBe('CATALOG#SERVICE_AREA');
    expect(input.Item.GSI1SK).toBe('000005#north');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('reads by id', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockServiceArea({ id: 'a-2' }) } });
    const area = await repository.get('a-2');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'SERVICE_AREA#a-2', SK: 'METADATA' });
    expect(area?.id).toBe('a-2');
  });

  it('returns null when an area is missing', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repository.get('missing')).toBeNull();
  });

  it('lists all areas via the catalog GSI', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [createMockServiceArea()] });
    const areas = await repository.listAll();

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StageIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe('CATALOG#SERVICE_AREA');
    expect(areas).toHaveLength(1);
  });

  it('deletes by id', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.remove('a-3');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'SERVICE_AREA#a-3', SK: 'METADATA' });
  });
});
