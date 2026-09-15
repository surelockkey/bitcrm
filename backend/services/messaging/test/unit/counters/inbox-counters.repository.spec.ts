import { InboxCountersRepository, countersAddUpdate } from '../../../src/counters/inbox-counters.repository';
import { T1, mockDynamo } from '../mocks';

function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new InboxCountersRepository(dynamo), sent };
}

describe('countersAddUpdate', () => {
  it('builds one ADD over flat attributes, skipping zeros', () => {
    expect(
      countersAddUpdate('T', { unreadConversations: 1, flaggedConversations: 0, unreadByKind: { client: 1, team: 0 } }),
    ).toEqual({
      TableName: 'T',
      Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' },
      UpdateExpression: 'ADD #unread :unread, #kind_client :kind_client',
      ExpressionAttributeNames: { '#unread': 'unreadConversations', '#kind_client': 'unreadKind_client' },
      ExpressionAttributeValues: { ':unread': 1, ':kind_client': 1 },
    });
  });

  it('is undefined for an empty delta', () => {
    expect(countersAddUpdate('T', {})).toBeUndefined();
    expect(countersAddUpdate('T', { unreadConversations: 0, unreadByKind: {} })).toBeUndefined();
  });
});

describe('InboxCountersRepository', () => {
  it('returns zeros when the item was never written', async () => {
    const { repo, sent } = makeRepo([{}]);
    expect(await repo.get()).toEqual({ unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} });
    expect(sent[0].input.Key).toEqual({ PK: 'INBOX#COUNTERS', SK: 'METADATA' });
  });

  it('folds the flat per-kind attributes back into unreadByKind', async () => {
    const { repo } = makeRepo([
      { Item: { PK: 'INBOX#COUNTERS', SK: 'METADATA', unreadConversations: 5, flaggedConversations: 2, unreadKind_client: 4, unreadKind_team: 1, unreadKind_unknown: 0 } },
    ]);
    expect(await repo.get()).toEqual({ unreadConversations: 5, flaggedConversations: 2, unreadByKind: { client: 4, team: 1 } });
  });

  it('add issues the ADD and skips an empty delta', async () => {
    const { repo, sent } = makeRepo();
    await repo.add({ flaggedConversations: -1 });
    await repo.add({});
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('UpdateCommand');
    expect(sent[0].input.UpdateExpression).toBe('ADD #flagged :flagged');
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':flagged': -1 });
  });

  it('set replaces every counter (the post-import recount)', async () => {
    const { repo, sent } = makeRepo();
    await repo.set({ unreadConversations: 1581, flaggedConversations: 0, unreadByKind: { client: 1500, unknown: 81 } }, T1);
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toEqual({
      PK: 'INBOX#COUNTERS',
      SK: 'METADATA',
      unreadConversations: 1581,
      flaggedConversations: 0,
      updatedAt: T1,
      unreadKind_client: 1500,
      unreadKind_unknown: 81,
      unreadKind_team: 0,
      unreadKind_group: 0,
      unreadKind_external: 0,
    });
  });
});
