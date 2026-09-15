import {
  ConversationsRepository,
  StaleConversationError,
  UNREAD_COUNT_CAP,
  applyPatch,
} from '../../../src/conversations/conversations.repository';
import { conversationItem } from '../../../src/conversations/conversation-keys';
import { T0, T1, createMockConversation, mockDynamo, transactionCanceled } from '../mocks';

/**
 * The MEMBER# / READ# side of the repository (design §3.2, §6): exact key
 * shapes, transaction composition and the GSI3 adjacency, against a
 * scripted client. Real DynamoDB behaviour is the integration spec's job.
 */
function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new ConversationsRepository(dynamo), sent };
}

const GROUP = createMockConversation({
  id: 'g1',
  kind: 'group',
  partyKind: 'group',
  partyId: 'g1',
  name: 'Night shift',
  addresses: { phones: [], emails: [] },
  createdBy: 'admin-1',
});
const member = (userId: string, role: 'owner' | 'member' = 'member', joinedAt = T0) => ({
  conversationId: 'g1',
  userId,
  role,
  joinedAt,
});

describe('applyPatch — group fields', () => {
  it('sets and clears name, replaces memberIds', () => {
    const renamed = applyPatch(GROUP, { name: 'Day shift' }, 'u1', T1);
    expect(renamed.next.name).toBe('Day shift');
    expect(renamed.fields).toEqual(['name']);

    const cleared = applyPatch(GROUP, { name: null }, 'u1', T1);
    expect(cleared.next.name).toBeUndefined();

    const roster = applyPatch(GROUP, { memberIds: ['a', 'b'] }, 'u1', T1);
    expect(roster.next.memberIds).toEqual(['a', 'b']);
    expect(roster.fields).toEqual(['memberIds']);
  });
});

describe('ConversationsRepository.createGroup', () => {
  it('puts the self-pointer, the header with memberIds and one MEMBER# row per member in one transaction', async () => {
    const { repo, sent } = makeRepo();
    const stored = await repo.createGroup(GROUP, [member('admin-1', 'owner'), member('tech-1')]);

    expect(stored.memberIds).toEqual(['admin-1', 'tech-1']);
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('TransactWriteCommand');
    const items = sent[0].input.TransactItems;
    expect(items).toHaveLength(4);
    expect(items[0].Put).toMatchObject({
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: { PK: 'CONVOF#group#g1', SK: 'METADATA', pointerKind: 'group', pointerId: 'g1', conversationId: 'g1', createdAt: T0 },
    });
    expect(items[1].Put).toMatchObject({
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: { PK: 'CONV#g1', SK: 'METADATA', kind: 'group', name: 'Night shift', memberIds: ['admin-1', 'tech-1'], GSI3PK: 'CAT#group#2026' },
    });
    expect(items[2].Put.Item).toEqual({
      PK: 'CONV#g1',
      SK: 'MEMBER#admin-1',
      conversationId: 'g1',
      userId: 'admin-1',
      role: 'owner',
      joinedAt: T0,
      GSI3PK: 'MEMBEROF#admin-1',
      GSI3SK: `${T0}#g1`,
    });
    expect(items[3].Put.Item).toMatchObject({ SK: 'MEMBER#tech-1', role: 'member', GSI3PK: 'MEMBEROF#tech-1' });
  });
});

describe('ConversationsRepository.updateMembers', () => {
  it('updates memberIds (and name) under the updatedAt guard, puts adds and deletes removes together', async () => {
    const { repo, sent } = makeRepo();
    const current = { ...GROUP, memberIds: ['admin-1', 'tech-1', 'tech-2'] };
    const next = await repo.updateMembers(
      current,
      { add: [member('tech-3', 'member', T1)], remove: ['tech-2'], name: 'Day shift' },
      { actorId: 'admin-1', at: T1 },
    );

    expect(next.memberIds).toEqual(['admin-1', 'tech-1', 'tech-3']);
    expect(next.name).toBe('Day shift');
    expect(next.updatedAt).toBe(T1);
    const [header, add, remove] = sent[0].input.TransactItems;
    expect(header.Update.Key).toEqual({ PK: 'CONV#g1', SK: 'METADATA' });
    expect(header.Update.ConditionExpression).toBe('attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt');
    expect(header.Update.ExpressionAttributeValues).toMatchObject({
      ':expectedUpdatedAt': T0,
      ':memberIds': ['admin-1', 'tech-1', 'tech-3'],
      ':name': 'Day shift',
    });
    expect(add.Put.Item).toMatchObject({ PK: 'CONV#g1', SK: 'MEMBER#tech-3', joinedAt: T1, GSI3PK: 'MEMBEROF#tech-3', GSI3SK: `${T1}#g1` });
    expect(remove.Delete).toEqual({ TableName: 'BitCRM_Messaging', Key: { PK: 'CONV#g1', SK: 'MEMBER#tech-2' } });
  });

  it('does not write for an empty change, a member already present, a removal of a non-member, or the same name', async () => {
    const { repo, sent } = makeRepo();
    const current = { ...GROUP, memberIds: ['admin-1'] };
    expect(await repo.updateMembers(current, {})).toBe(current);
    expect(await repo.updateMembers(current, { add: [member('admin-1', 'owner')] }, { at: T1 })).toBe(current);
    expect(await repo.updateMembers(current, { remove: ['nobody'] }, { at: T1 })).toBe(current);
    expect(await repo.updateMembers(current, { name: 'Night shift' }, { at: T1 })).toBe(current);
    expect(sent).toHaveLength(0);
  });

  it('surfaces a lost optimistic lock as StaleConversationError', async () => {
    const { repo } = makeRepo([transactionCanceled(['ConditionalCheckFailed', 'None'])]);
    await expect(repo.updateMembers({ ...GROUP, memberIds: [] }, { add: [member('x')] })).rejects.toBeInstanceOf(
      StaleConversationError,
    );
  });
});

describe('ConversationsRepository membership reads', () => {
  it('getMember / listMembers address the MEMBER# rows of the partition', async () => {
    const { repo, sent } = makeRepo([
      { Item: { PK: 'CONV#g1', SK: 'MEMBER#tech-1', ...member('tech-1'), GSI3PK: 'MEMBEROF#tech-1', GSI3SK: `${T0}#g1` } },
      { Items: [{ PK: 'CONV#g1', SK: 'MEMBER#admin-1', ...member('admin-1', 'owner'), GSI3PK: 'x', GSI3SK: 'y' }] },
    ]);
    expect(await repo.getMember('g1', 'tech-1')).toEqual(member('tech-1'));
    expect(await repo.listMembers('g1')).toEqual([member('admin-1', 'owner')]);

    expect(sent[0].input.Key).toEqual({ PK: 'CONV#g1', SK: 'MEMBER#tech-1' });
    expect(sent[1].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'CONV#g1', ':prefix': 'MEMBER#' },
    });
    expect(sent[1].input.FilterExpression).toBeUndefined();
  });

  it('listMemberOf reads the MEMBEROF# partition on the CategoryIndex and follows LastEvaluatedKey', async () => {
    const lek = { PK: 'CONV#g1', SK: 'MEMBER#tech-1', GSI3PK: 'MEMBEROF#tech-1', GSI3SK: `${T0}#g1` };
    const { repo, sent } = makeRepo([
      { Items: [{ ...lek, ...member('tech-1') }], LastEvaluatedKey: lek },
      { Items: [{ PK: 'CONV#g2', SK: 'MEMBER#tech-1', GSI3PK: 'MEMBEROF#tech-1', GSI3SK: `${T1}#g2`, ...member('tech-1'), conversationId: 'g2' }] },
    ]);
    const rows = await repo.listMemberOf('tech-1');
    expect(rows.map((m) => m.conversationId)).toEqual(['g1', 'g2']);
    expect(sent).toHaveLength(2);
    expect(sent[0].input).toMatchObject({
      IndexName: 'CategoryIndex',
      ExpressionAttributeNames: { '#pk': 'GSI3PK' },
      ExpressionAttributeValues: { ':pk': 'MEMBEROF#tech-1' },
    });
    expect(sent[1].input.ExclusiveStartKey).toEqual(lek);
  });
});

describe('ConversationsRepository read markers', () => {
  it('putReadMarker writes READ#<userId> alone — no header update, no counters', async () => {
    const { repo, sent } = makeRepo();
    const marker = await repo.putReadMarker('g1', 'tech-1', { lastReadMessageSk: `MSG#${T1}#m1`, at: T1 });
    expect(marker).toEqual({ conversationId: 'g1', userId: 'tech-1', lastReadAt: T1, lastReadMessageSk: `MSG#${T1}#m1` });
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toEqual({
      PK: 'CONV#g1',
      SK: 'READ#tech-1',
      conversationId: 'g1',
      userId: 'tech-1',
      lastReadAt: T1,
      lastReadMessageSk: `MSG#${T1}#m1`,
    });
  });

  it('listReadMarkers queries the READ# prefix', async () => {
    const { repo, sent } = makeRepo([
      { Items: [{ PK: 'CONV#g1', SK: 'READ#a', conversationId: 'g1', userId: 'a', lastReadAt: T0 }] },
    ]);
    expect(await repo.listReadMarkers('g1')).toEqual([{ conversationId: 'g1', userId: 'a', lastReadAt: T0 }]);
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'CONV#g1', ':prefix': 'READ#' });
  });
});

describe('ConversationsRepository.countMessagesAfter', () => {
  it('counts MSG# rows after a marker with a COUNT query, filtering out the READ# tail, capped', async () => {
    const { repo, sent } = makeRepo([{ Count: 7 }]);
    expect(await repo.countMessagesAfter('g1', `MSG#${T0}#m0`)).toBe(7);
    expect(sent[0].name).toBe('QueryCommand');
    expect(sent[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND SK > :after',
      FilterExpression: 'begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'CONV#g1', ':after': `MSG#${T0}#m0`, ':prefix': 'MSG#' },
      Select: 'COUNT',
      Limit: UNREAD_COUNT_CAP,
    });
  });

  it('without a marker counts the whole MSG# range with a key condition only', async () => {
    const { repo, sent } = makeRepo([{ Count: 250 }]);
    expect(await repo.countMessagesAfter('g1', undefined, 99)).toBe(99);
    expect(sent[0].input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :prefix)');
    expect(sent[0].input.FilterExpression).toBeUndefined();
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'CONV#g1', ':prefix': 'MSG#' });
  });
});

describe('group header round trip', () => {
  it('keeps name, memberIds and createdBy through the item mapping', () => {
    const item = conversationItem({ ...GROUP, memberIds: ['a'] });
    expect(item).toMatchObject({ name: 'Night shift', memberIds: ['a'], createdBy: 'admin-1', GSI3PK: 'CAT#group#2026' });
  });
});
