import { InventoryStatus } from '@bitcrm/types';
import { ContainerTemplatesRepository } from 'src/container-templates/container-templates.repository';
import { INVENTORY_TABLE } from 'src/common/constants/dynamo.constants';
import { createMockContainerTemplate, createMockDynamoDbService } from '../mocks';

/**
 * Шаблони фургонів — каталог: рядок на шаблон, список на GSI1 зі сталою
 * партицією. Пошук за назвою — ключова умова на GSI1SK з дочитуванням
 * сторінок, а не Scan + Limit 1 (той фільтрує після ліміту й каже "вільно").
 */
describe('ContainerTemplatesRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ContainerTemplatesRepository;

  const stored = (template = createMockContainerTemplate()) => ({
    ...template,
    PK: `CONTAINER_TEMPLATE#${template.id}`,
    SK: 'METADATA',
    GSI1PK: 'CATALOG#CONTAINER_TEMPLATE',
    GSI1SK: template.name.trim().toLowerCase(),
  });

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    repository = new ContainerTemplatesRepository(dynamoDb as any);
  });

  it('creates the row with its list keys, refusing an id that exists', async () => {
    const template = createMockContainerTemplate({ name: ' Standard Van ' });

    await repository.create(template);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.TableName).toBe(INVENTORY_TABLE);
    expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(input.Item).toEqual({
      ...template,
      PK: 'CONTAINER_TEMPLATE#tpl-1',
      SK: 'METADATA',
      GSI1PK: 'CATALOG#CONTAINER_TEMPLATE',
      GSI1SK: 'standard van',
    });
  });

  it('replaces the whole row on put, so a cleared description is gone', async () => {
    const { description: _d, ...bare } = createMockContainerTemplate({ status: InventoryStatus.ARCHIVED });

    await repository.put(bare);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(dynamoDb.client.send.mock.calls[0][0].constructor.name).toBe('PutCommand');
    expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(input.Item).not.toHaveProperty('description');
    expect(input.Item.status).toBe(InventoryStatus.ARCHIVED);
  });

  it('reads one template by key without leaking the keys', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: stored() });

    expect(await repository.findById('tpl-1')).toEqual(createMockContainerTemplate());
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
      PK: 'CONTAINER_TEMPLATE#tpl-1',
      SK: 'METADATA',
    });
  });

  it('answers null for an unknown id', async () => {
    expect(await repository.findById('missing')).toBeNull();
  });

  it('lists the catalog partition to the end, in name order', async () => {
    const a = createMockContainerTemplate({ id: 'a', name: 'Alpha' });
    const b = createMockContainerTemplate({ id: 'b', name: 'Beta' });
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [stored(a)], LastEvaluatedKey: { PK: 'k' } })
      .mockResolvedValueOnce({ Items: [stored(b)] });

    expect(await repository.listAll()).toEqual([a, b]);
    const [first, second] = dynamoDb.client.send.mock.calls.map((c) => c[0].input);
    expect(first).toMatchObject({
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'CATALOG#CONTAINER_TEMPLATE' },
    });
    expect(second.ExclusiveStartKey).toEqual({ PK: 'k' });
  });

  it('finds templates by name case-insensitively on the sort key, paging to the end', async () => {
    const active = createMockContainerTemplate({ id: 'a', name: 'Standard van' });
    const archived = createMockContainerTemplate({ id: 'b', name: 'STANDARD VAN', status: InventoryStatus.ARCHIVED });
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'k' } })
      .mockResolvedValueOnce({ Items: [stored(active), stored(archived)] });

    const found = await repository.findByName('  Standard Van ');

    expect(found).toEqual([active, archived]);
    const [first, second] = dynamoDb.client.send.mock.calls.map((c) => c[0].input);
    expect(first).toMatchObject({
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :name',
      ExpressionAttributeValues: { ':pk': 'CATALOG#CONTAINER_TEMPLATE', ':name': 'standard van' },
    });
    expect(first.Limit).toBeUndefined();
    expect(second.ExclusiveStartKey).toEqual({ PK: 'k' });
  });
});
