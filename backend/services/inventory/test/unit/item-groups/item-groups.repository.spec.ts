import { ItemGroupsRepository } from 'src/item-groups/item-groups.repository';
import { createMockDynamoDbService } from '../mocks';

/**
 * The row the Workiz import writes (workiz/bitcrm/entities/inventory.py
 * `_write_item_groups`): one METADATA row per group, the members inline,
 * each with the importer's extras beside the fields a job line takes.
 */
const importedRow = {
  PK: 'ITEM_GROUP#group-1',
  SK: 'METADATA',
  GSI1PK: 'CATALOG#ITEM_GROUP',
  GSI1SK: '7quo80 estimate',
  id: 'group-1',
  name: '7QUO80 ESTIMATE',
  resource: 'inventory',
  groupType: 'separate_items',
  isEnabled: true,
  externalId: 'workiz:item_group:336916',
  createdBy: 'workiz-import',
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  members: [
    {
      productId: 'prod-screen',
      name: 'White Aluminum Screen for Right-Hand Sliding Patio Door',
      quantity: 1,
      priceClient: 300,
      taxable: true,
      description: 'Retractable, 59.25 x 79.5',
      customAttributes: { 'In Store Location': 'Aisle 4' },
      // importer extras — never on the API
      cost: 120,
      workizItemId: '15195',
      manageStock: false,
      nonDiscountable: false,
      groupMemberId: '1484188',
    },
    {
      productId: 'prod-labor',
      name: 'Minimum 1 Hour Of Labor for Screen Door Installation',
      quantity: 2,
      priceClient: 125,
      taxable: false,
      cost: 0,
    },
  ],
};

describe('ItemGroupsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ItemGroupsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ItemGroupsRepository(dynamoDb as any);
  });

  it('listAll() Queries the catalog partition on GSI1 to its end — no Scan', async () => {
    const key = { PK: 'ITEM_GROUP#group-1', SK: 'METADATA', GSI1PK: 'CATALOG#ITEM_GROUP', GSI1SK: 'a' };
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [importedRow], LastEvaluatedKey: key })
      .mockResolvedValueOnce({ Items: [{ ...importedRow, id: 'group-2', name: 'Commercial door' }] });

    const list = await repository.listAll();

    expect(list.map((g) => g.name)).toEqual(['7QUO80 ESTIMATE', 'Commercial door']);
    const first = dynamoDb.client.send.mock.calls[0][0];
    expect(first.constructor.name).toBe('QueryCommand');
    expect(first.input).toMatchObject({
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'CATALOG#ITEM_GROUP' },
    });
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual(key);
  });

  it('get() reads ITEM_GROUP#<id> / METADATA', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow });

    const group = await repository.get('group-1');

    expect(group?.id).toBe('group-1');
    const cmd = dynamoDb.client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('GetCommand');
    expect(cmd.input.Key).toEqual({ PK: 'ITEM_GROUP#group-1', SK: 'METADATA' });
  });

  it('get() answers null for a group that is not there', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({});

    await expect(repository.get('nope')).resolves.toBeNull();
  });

  it('reads the imported row as the API shape: members as a job line takes them, total, no keys', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow });

    const group = await repository.get('group-1');

    expect(group).toEqual({
      id: 'group-1',
      name: '7QUO80 ESTIMATE',
      description: '',
      total: 550,
      externalId: 'workiz:item_group:336916',
      createdBy: 'workiz-import',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
      members: [
        {
          productId: 'prod-screen',
          name: 'White Aluminum Screen for Right-Hand Sliding Patio Door',
          quantity: 1,
          priceClient: 300,
          taxable: true,
          description: 'Retractable, 59.25 x 79.5',
          customAttributes: { 'In Store Location': 'Aisle 4' },
        },
        {
          productId: 'prod-labor',
          name: 'Minimum 1 Hour Of Labor for Screen Door Installation',
          quantity: 2,
          priceClient: 125,
          taxable: false,
          description: '',
          customAttributes: {},
        },
      ],
    });
  });

  it('never carries a member cost — a technician reads groups without financials.view', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow });

    const group = await repository.get('group-1');

    for (const member of group!.members) {
      expect(member).not.toHaveProperty('cost');
      expect(member).not.toHaveProperty('workizItemId');
    }
  });

  it('leaves out a member whose Workiz item has no product here — it could not become a job line', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({
      Item: {
        ...importedRow,
        members: [{ ...importedRow.members[0] }, { productId: null, name: 'Gone', quantity: 1, priceClient: 10 }],
      },
    });

    const group = await repository.get('group-1');

    expect(group!.members.map((m) => m.productId)).toEqual(['prod-screen']);
    expect(group!.total).toBe(300);
  });

  it('rounds the total to cents and copes with a row that has no members', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({
        Item: {
          ...importedRow,
          members: [{ productId: 'p', name: 'Pin', quantity: 3, priceClient: 0.1, taxable: true }],
        },
      })
      .mockResolvedValueOnce({ Item: { ...importedRow, members: undefined } });

    expect((await repository.get('group-1'))!.total).toBe(0.3);
    const empty = await repository.get('group-1');
    expect(empty!.members).toEqual([]);
    expect(empty!.total).toBe(0);
  });

  it('defaults a member without a taxable flag to taxable, as a price-book product', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({
      Item: { ...importedRow, members: [{ productId: 'p', name: 'Pin', quantity: 1, priceClient: 5 }] },
    });

    expect((await repository.get('group-1'))!.members[0].taxable).toBe(true);
  });
});
