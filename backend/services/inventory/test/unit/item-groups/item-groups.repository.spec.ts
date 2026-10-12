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
      groupType: 'separate_items',
      active: true,
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
          cost: 120,
        },
        {
          productId: 'prod-labor',
          name: 'Minimum 1 Hour Of Labor for Screen Door Installation',
          quantity: 2,
          priceClient: 125,
          taxable: false,
          description: '',
          customAttributes: {},
          cost: 0,
        },
      ],
    });
  });

  it("carries the group's own member cost (the controller hides it without financials.view), never the importer's other extras", async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow });

    const group = await repository.get('group-1');

    expect(group!.members.map((m) => m.cost)).toEqual([120, 0]);
    for (const member of group!.members) {
      expect(member).not.toHaveProperty('workizItemId');
      expect(member).not.toHaveProperty('manageStock');
    }
  });

  it('leaves the cost off a member that has none stored', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({
      Item: { ...importedRow, members: [{ productId: 'p', name: 'Pin', quantity: 1, priceClient: 5 }] },
    });

    expect((await repository.get('group-1'))!.members[0]).not.toHaveProperty('cost');
  });

  it("reads Workiz's group type, status and category: separate_items / isEnabled from the import, active from BitCRM", async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Item: { ...importedRow, groupType: 'flat_rate', isEnabled: false, categoryId: 'cat-1' } })
      .mockResolvedValueOnce({ Item: { ...importedRow, groupType: undefined, isEnabled: undefined } })
      // BitCRM's own `active` wins over the importer's `isEnabled`.
      .mockResolvedValueOnce({ Item: { ...importedRow, isEnabled: true, active: false, categoryId: '' } });

    const flat = await repository.get('group-1');
    expect(flat).toMatchObject({ groupType: 'flat_rate', active: false, categoryId: 'cat-1' });
    const bare = await repository.get('group-1');
    expect(bare).toMatchObject({ groupType: 'separate_items', active: true });
    expect(bare).not.toHaveProperty('categoryId');
    const disabled = await repository.get('group-1');
    expect(disabled!.active).toBe(false);
    expect(disabled).not.toHaveProperty('categoryId');
  });

  it('getRow() answers the stored row as it is — the importer extras on the members included', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow }).mockResolvedValueOnce({});

    expect(await repository.getRow('group-1')).toBe(importedRow);
    await expect(repository.getRow('nope')).resolves.toBeNull();
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({ PK: 'ITEM_GROUP#group-1', SK: 'METADATA' });
  });

  it('create() puts ITEM_GROUP#<id> / METADATA on the catalog partition, refusing an id already there', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({});
    const members = [{ productId: 'p', name: 'Pin', quantity: 1, priceClient: 5, taxable: true, cost: 2 }];

    await repository.create({
      id: 'g-new',
      name: 'Storm Door 36" x 80"',
      description: 'Door + labor',
      groupType: 'separate_items',
      categoryId: 'cat-1',
      active: true,
      members,
      createdBy: 'user-1',
      createdAt: '2026-10-12T10:00:00.000Z',
      updatedAt: '2026-10-12T10:00:00.000Z',
    });

    const cmd = dynamoDb.client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('PutCommand');
    expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(cmd.input.Item).toEqual({
      PK: 'ITEM_GROUP#g-new',
      SK: 'METADATA',
      GSI1PK: 'CATALOG#ITEM_GROUP',
      GSI1SK: 'storm door 36" x 80"',
      id: 'g-new',
      name: 'Storm Door 36" x 80"',
      description: 'Door + labor',
      groupType: 'separate_items',
      categoryId: 'cat-1',
      active: true,
      members,
      createdBy: 'user-1',
      createdAt: '2026-10-12T10:00:00.000Z',
      updatedAt: '2026-10-12T10:00:00.000Z',
    });
  });

  it("update() SETs only what changed, renames the sort key with the name, and keeps the importer's attributes", async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: { ...importedRow, name: 'Screen door', active: false } });
    const members = [{ productId: 'p', name: 'Pin', quantity: 2, priceClient: 5, taxable: true }];

    const group = await repository.update(
      'group-1',
      { name: 'Screen door', description: 'x', members, active: false, categoryId: 'cat-2' },
      { updatedAt: '2026-10-12T11:00:00.000Z', updatedBy: 'user-1' },
    );

    const cmd = dynamoDb.client.send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('UpdateCommand');
    expect(cmd.input.Key).toEqual({ PK: 'ITEM_GROUP#group-1', SK: 'METADATA' });
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(cmd.input.ReturnValues).toBe('ALL_NEW');
    const values = cmd.input.ExpressionAttributeValues;
    expect(Object.values(values)).toEqual(
      expect.arrayContaining(['Screen door', 'screen door', 'x', members, false, 'cat-2', '2026-10-12T11:00:00.000Z', 'user-1']),
    );
    // Workiz's comma list of member names goes stale with new members: dropped.
    expect(cmd.input.UpdateExpression).toMatch(/REMOVE .*#itemNames/);
    expect(group).toMatchObject({ id: 'group-1', name: 'Screen door', active: false });
  });

  it('update() REMOVEs the category when it is cleared, and leaves the members and name alone when not sent', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: importedRow });

    await repository.update('group-1', { categoryId: null }, { updatedAt: 't', updatedBy: 'u' });

    const cmd = dynamoDb.client.send.mock.calls[0][0];
    expect(cmd.input.UpdateExpression).toMatch(/REMOVE .*#categoryId/);
    expect(cmd.input.UpdateExpression).not.toMatch(/#members|#name\b|#itemNames/);
    expect(Object.values(cmd.input.ExpressionAttributeNames)).not.toContain('GSI1SK');
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
