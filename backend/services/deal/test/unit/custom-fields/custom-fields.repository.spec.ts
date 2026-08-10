import { CustomFieldsRepository } from 'src/custom-fields/custom-fields.repository';
import { createMockDynamoDbService, createMockCustomField } from '../mocks';

describe('CustomFieldsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: CustomFieldsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new CustomFieldsRepository(dynamoDb as any);
  });

  it('writes catalog keys on create', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockCustomField({ id: 'cf-1', name: 'Gate Code', priority: 5 }));

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('CUSTOM_FIELD#cf-1');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.GSI1PK).toBe('CATALOG#CUSTOM_FIELD');
    expect(input.Item.GSI1SK).toBe('000005#gate code');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('reads by id', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockCustomField({ id: 'cf-2' }) } });
    const field = await repository.get('cf-2');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'CUSTOM_FIELD#cf-2', SK: 'METADATA' });
    expect(field?.id).toBe('cf-2');
  });

  it('returns null when a custom field is missing', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    expect(await repository.get('missing')).toBeNull();
  });

  it('maps every definition field, defaulting options and jobTypeIds', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: {
        id: 'cf-3',
        name: 'Lock Brand',
        type: 'dropdown',
        group: 'Hardware',
        options: ['Kwikset', 'Schlage'],
        jobTypeIds: ['jt-1'],
        required: true,
        requiredToClose: true,
        searchable: true,
        priority: 7,
        active: true,
        createdBy: 'admin-1',
        createdAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    });
    const field = await repository.get('cf-3');
    expect(field).toMatchObject({
      id: 'cf-3',
      type: 'dropdown',
      group: 'Hardware',
      options: ['Kwikset', 'Schlage'],
      jobTypeIds: ['jt-1'],
      required: true,
      requiredToClose: true,
      searchable: true,
      priority: 7,
    });
  });

  it('defaults options and jobTypeIds to empty arrays when absent', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: { id: 'cf-4', name: 'Notes', type: 'text', priority: 0 },
    });
    const field = await repository.get('cf-4');
    expect(field?.options).toEqual([]);
    expect(field?.jobTypeIds).toEqual([]);
  });

  it('lists all custom fields via the catalog GSI', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [createMockCustomField()] });
    const fields = await repository.listAll();

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StageIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe('CATALOG#CUSTOM_FIELD');
    expect(fields).toHaveLength(1);
  });

  it('detects a custom field still referenced by a deal via nested-path filter', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [{ id: 'deal-1' }] });
    expect(await repository.isReferencedByDeal('cf-1')).toBe(true);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('attribute_exists(#cf.#fid)');
    expect(input.ExpressionAttributeNames['#cf']).toBe('customFields');
    expect(input.ExpressionAttributeNames['#fid']).toBe('cf-1');
    expect(input.Limit).toBe(1);
  });

  it('reports no reference when the scan is empty', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    expect(await repository.isReferencedByDeal('cf-1')).toBe(false);
  });

  it('deletes by id', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.remove('cf-3');

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'CUSTOM_FIELD#cf-3', SK: 'METADATA' });
  });
});
