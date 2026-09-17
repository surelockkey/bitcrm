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

  it('round-trips tax and defaultBusinessProfileId (a full-Put update would otherwise drop them)', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: {
        ...createMockServiceArea({ id: 'a-9' }),
        tax: { name: 'CT Sales Tax', ratePercent: 6.35 },
        defaultBusinessProfileId: 'bp-2',
      },
    });
    const area = await repository.get('a-9');
    expect(area?.tax).toEqual({ name: 'CT Sales Tax', ratePercent: 6.35 });
    expect(area?.defaultBusinessProfileId).toBe('bp-2');

    dynamoDb.client.send.mockResolvedValue({ Item: createMockServiceArea({ id: 'a-9' }) });
    const bare = await repository.get('a-9');
    expect(bare).not.toHaveProperty('tax');
    expect(bare).not.toHaveProperty('defaultBusinessProfileId');
  });

  it('does not surface the legacy defaultTaxRateId attribute', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: { ...createMockServiceArea({ id: 'a-9' }), defaultTaxRateId: 'tax-1' },
    });
    expect(await repository.get('a-9')).not.toHaveProperty('defaultTaxRateId');
  });

  it('writes tax and defaultBusinessProfileId on put', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.put(
      createMockServiceArea({ id: 'a-1', tax: { name: 'T', ratePercent: 1 }, defaultBusinessProfileId: 'bp-1' }),
    );
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.tax).toEqual({ name: 'T', ratePercent: 1 });
    expect(input.Item.defaultBusinessProfileId).toBe('bp-1');
  });

  it('deletes by id', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.remove('a-3');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'SERVICE_AREA#a-3', SK: 'METADATA' });
  });
});
