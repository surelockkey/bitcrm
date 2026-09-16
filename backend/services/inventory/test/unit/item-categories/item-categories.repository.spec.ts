import { ItemCategoriesRepository } from 'src/item-categories/item-categories.repository';
import { createMockDynamoDbService, createMockItemCategory } from '../mocks';

/**
 * Rows written by the Workiz import carry attributes the entity does not
 * declare (`externalId`, `parentId`, `description`, `workizFileId`). The
 * update path is a full Put of the entity, so the mapper must carry them.
 */
describe('ItemCategoriesRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ItemCategoriesRepository;

  const importedRow = {
    PK: 'ITEM_CATEGORY#cat-1',
    SK: 'METADATA',
    GSI1PK: 'CATALOG#ITEM_CATEGORY',
    GSI1SK: 'door hardware',
    id: 'cat-1',
    name: 'Door Hardware',
    active: true,
    createdBy: 'workiz-import',
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    externalId: 'workiz:category:1511',
    parentId: null,
    description: '',
    workizFileId: '33144326',
  };

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ItemCategoriesRepository(dynamoDb as any);
  });

  it('get() keeps importer attributes on the entity and drops the key attributes', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: importedRow });

    const category = (await repository.get('cat-1')) as unknown as Record<string, unknown>;

    expect(category).toMatchObject({
      id: 'cat-1',
      name: 'Door Hardware',
      active: true,
      externalId: 'workiz:category:1511',
      workizFileId: '33144326',
    });
    expect(category.PK).toBeUndefined();
    expect(category.GSI1SK).toBeUndefined();
  });

  it('put() after a rename writes the importer attributes back and rebuilds the list key', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow }).mockResolvedValueOnce({});

    const existing = await repository.get('cat-1');
    await repository.put({ ...existing!, name: 'Door Hardware & Locks' });

    const putItem = dynamoDb.client.send.mock.calls[1][0].input.Item;
    expect(putItem).toMatchObject({
      PK: 'ITEM_CATEGORY#cat-1',
      SK: 'METADATA',
      GSI1PK: 'CATALOG#ITEM_CATEGORY',
      GSI1SK: 'door hardware & locks',
      name: 'Door Hardware & Locks',
      externalId: 'workiz:category:1511',
      workizFileId: '33144326',
    });
  });

  it('the typed fields win over stray stored values', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...importedRow, active: 'yes' } });

    const category = await repository.get('cat-1');

    expect(category!.active).toBe(true);
  });

  it('findByName() queries the list index by the lowercased name', async () => {
    const stored = createMockItemCategory({ id: 'cat-u', name: 'Uncategorized' });
    dynamoDb.client.send.mockResolvedValue({ Items: [{ ...stored, PK: 'ITEM_CATEGORY#cat-u', SK: 'METADATA' }] });

    const found = await repository.findByName('  UNCATEGORIZED ');

    expect(found).toMatchObject({ id: 'cat-u', name: 'Uncategorized' });
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toBe('GSI1PK = :pk AND GSI1SK = :sk');
    expect(input.ExpressionAttributeValues).toEqual({
      ':pk': 'CATALOG#ITEM_CATEGORY',
      ':sk': 'uncategorized',
    });
  });

  it('findByName() returns null when nothing matches', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await expect(repository.findByName('Nope')).resolves.toBeNull();
  });
});
