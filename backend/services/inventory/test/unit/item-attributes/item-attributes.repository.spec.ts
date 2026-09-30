import { ItemAttributesRepository } from 'src/item-attributes/item-attributes.repository';
import { createMockDynamoDbService } from '../mocks';

/** The row the Workiz import writes (workiz/bitcrm/entities/inventory.py `_write_attributes`). */
const importedRow = {
  PK: 'ITEM_ATTRIBUTE#attr-1',
  SK: 'METADATA',
  GSI1PK: 'CATALOG#ITEM_ATTRIBUTE',
  GSI1SK: 'link_uhs',
  id: 'attr-1',
  name: 'Link_UHS',
  attrType: 'text',
  visible: false,
  resource: 'items',
  externalId: 'workiz:attribute:5589',
};

const conditionFailure = () =>
  Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });

describe('ItemAttributesRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ItemAttributesRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ItemAttributesRepository(dynamoDb as any);
  });

  it('listAll() Queries the catalog partition on GSI1 to its end — no Scan', async () => {
    const key = { PK: 'ITEM_ATTRIBUTE#attr-1', SK: 'METADATA', GSI1PK: 'CATALOG#ITEM_ATTRIBUTE', GSI1SK: 'link_uhs' };
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [importedRow], LastEvaluatedKey: key })
      .mockResolvedValueOnce({ Items: [{ ...importedRow, id: 'attr-2', name: 'SKU_CRM' }] });

    const list = await repository.listAll();

    expect(list.map((a) => a.name)).toEqual(['Link_UHS', 'SKU_CRM']);
    const first = dynamoDb.client.send.mock.calls[0][0];
    expect(first.constructor.name).toBe('QueryCommand');
    expect(first.input).toMatchObject({
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'CATALOG#ITEM_ATTRIBUTE' },
    });
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual(key);
  });

  it('reads the imported row as an entity: attrType → type, keys left out, extras kept', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow });

    const attribute = await repository.get('attr-1');

    expect(attribute).toMatchObject({
      id: 'attr-1',
      name: 'Link_UHS',
      type: 'text',
      visible: false,
      resource: 'items',
      externalId: 'workiz:attribute:5589',
    });
    const record = attribute as unknown as Record<string, unknown>;
    expect(record.PK).toBeUndefined();
    expect(record.GSI1SK).toBeUndefined();
    expect(record.attrType).toBeUndefined();
  });

  it('put() writes the importer shape back: attrType, GSI1 keys on the lowercased name, extras', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow }).mockResolvedValueOnce({});

    const attribute = await repository.get('attr-1');
    await repository.put({ ...attribute!, name: 'LINK_UHS', visible: true });

    const item = dynamoDb.client.send.mock.calls[1][0].input.Item;
    expect(item).toEqual({
      PK: 'ITEM_ATTRIBUTE#attr-1',
      SK: 'METADATA',
      GSI1PK: 'CATALOG#ITEM_ATTRIBUTE',
      GSI1SK: 'link_uhs',
      id: 'attr-1',
      name: 'LINK_UHS',
      attrType: 'text',
      visible: true,
      resource: 'items',
      externalId: 'workiz:attribute:5589',
    });
  });

  it('create() refuses to overwrite an existing id', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({});
    await repository.create({ id: 'attr-9', name: 'Bin', type: 'text', visible: false, resource: 'items' });
    expect(dynamoDb.client.send.mock.calls[0][0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
  });

  describe('forEachProductWithAttribute()', () => {
    it('Queries the Price Book partition (GSI4 PRODUCTS#ALL) filtered on the key, page by page', async () => {
      const key = { PK: 'PRODUCT#p1', SK: 'METADATA', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'a#p1' };
      const key2 = { ...key, PK: 'PRODUCT#p9', GSI4SK: 'm#p9' };
      dynamoDb.client.send
        .mockResolvedValueOnce({
          Items: [{ id: 'p1', customAttributes: { 'In Store Location': 'A4' } }],
          LastEvaluatedKey: key,
        })
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: key2 })
        .mockResolvedValueOnce({
          Items: [{ id: 'p2', customAttributes: { 'In Store Location': 'B1' } }],
        });
      const pages: string[][] = [];

      const matched = await repository.forEachProductWithAttribute('In Store Location', async (rows) => {
        pages.push(rows.map((r) => r.id));
      });

      expect(matched).toBe(2);
      // An empty (filtered-out) page is read past, not handed on.
      expect(pages).toEqual([['p1'], ['p2']]);
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(dynamoDb.client.send.mock.calls[0][0].constructor.name).toBe('QueryCommand');
      expect(input).toMatchObject({
        IndexName: 'TransferEntityIndex',
        KeyConditionExpression: 'GSI4PK = :pk',
        FilterExpression: 'attribute_exists(#ca.#name)',
        ExpressionAttributeNames: { '#ca': 'customAttributes', '#name': 'In Store Location' },
        ExpressionAttributeValues: { ':pk': 'PRODUCTS#ALL' },
      });
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual(key);
    });
  });

  describe('renameProductValue()', () => {
    it('moves the value in one conditional write', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({});

      await expect(repository.renameProductValue('p1', 'ALL SKU', 'All SKUs')).resolves.toBe(true);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input).toMatchObject({
        Key: { PK: 'PRODUCT#p1', SK: 'METADATA' },
        UpdateExpression: 'SET #ca.#to = #ca.#from REMOVE #ca.#from',
        ConditionExpression: 'attribute_exists(#ca.#from) AND attribute_not_exists(#ca.#to)',
        ExpressionAttributeNames: { '#ca': 'customAttributes', '#from': 'ALL SKU', '#to': 'All SKUs' },
      });
    });

    it('answers false when the condition fails (value gone, or the new name already taken)', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(conditionFailure());
      await expect(repository.renameProductValue('p1', 'a', 'b')).resolves.toBe(false);
    });

    it('rethrows any other error', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(new Error('throttled'));
      await expect(repository.renameProductValue('p1', 'a', 'b')).rejects.toThrow('throttled');
    });
  });

  describe('removeProductValue()', () => {
    it('removes only that key, conditioned on it being there', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({});

      await expect(repository.removeProductValue('p1', 'SKU_CRM')).resolves.toBe(true);

      expect(dynamoDb.client.send.mock.calls[0][0].input).toMatchObject({
        Key: { PK: 'PRODUCT#p1', SK: 'METADATA' },
        UpdateExpression: 'REMOVE #ca.#name',
        ConditionExpression: 'attribute_exists(#ca.#name)',
        ExpressionAttributeNames: { '#ca': 'customAttributes', '#name': 'SKU_CRM' },
      });
    });

    it('answers false when the product no longer has it', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(conditionFailure());
      await expect(repository.removeProductValue('p1', 'SKU_CRM')).resolves.toBe(false);
    });
  });
});
