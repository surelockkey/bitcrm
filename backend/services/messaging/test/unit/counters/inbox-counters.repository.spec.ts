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

  it('moves the totals on their own flat attributes', () => {
    expect(
      countersAddUpdate('T', { totalConversations: -1, archivedConversations: 1, totalByKind: { client: -1 } }),
    ).toEqual({
      TableName: 'T',
      Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' },
      UpdateExpression: 'ADD #total :total, #archived :archived, #totalkind_client :totalkind_client',
      ExpressionAttributeNames: {
        '#total': 'totalConversations',
        '#archived': 'archivedConversations',
        '#totalkind_client': 'totalKind_client',
      },
      ExpressionAttributeValues: { ':total': -1, ':archived': 1, ':totalkind_client': -1 },
    });
  });

  it('keeps the unread and the total attributes apart — they never collide', () => {
    const update = countersAddUpdate('T', { unreadByKind: { client: 1 }, totalByKind: { client: 1 } })!;
    expect(Object.values(update.ExpressionAttributeNames)).toEqual(['unreadKind_client', 'totalKind_client']);
    expect(Object.keys(update.ExpressionAttributeValues)).toHaveLength(2);
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
    // A caller that counted only the unread numbers must not publish a totals
    // figure it never counted — so no `total*`, and no recount stamp.
    expect(sent[0].input.Item.totalConversations).toBeUndefined();
    expect(sent[0].input.Item.totalsRecountedAt).toBeUndefined();
  });

  // ------------------------------------------------------------- totals
  it('hides the totals until they have been recounted at least once', async () => {
    // The dev bug's shape: the loader wrote 42 657 conversations straight into
    // DynamoDB, so whatever `totalConversations` the live ADDs accumulated is
    // far below the truth. Without the stamp `get()` reports none of it, and
    // the column falls back instead of printing a wrong number.
    const { repo } = makeRepo([
      { Item: { PK: 'INBOX#COUNTERS', SK: 'METADATA', unreadConversations: 5, totalConversations: 12, totalKind_client: 12 } },
    ]);
    const counters = await repo.get();
    expect(counters.totalConversations).toBeUndefined();
    expect(counters.totalByKind).toBeUndefined();
    expect(counters.archivedConversations).toBeUndefined();
    expect(counters.unreadConversations).toBe(5);
  });

  it('reports the totals once the recount stamp is there', async () => {
    const { repo } = makeRepo([
      {
        Item: {
          PK: 'INBOX#COUNTERS',
          SK: 'METADATA',
          unreadConversations: 4,
          flaggedConversations: 1,
          unreadKind_client: 3,
          totalConversations: 42_657,
          totalKind_client: 42_423,
          totalKind_team: 234,
          totalKind_unknown: 0,
          archivedConversations: 2,
          totalsRecountedAt: T1,
        },
      },
    ]);
    expect(await repo.get()).toEqual({
      unreadConversations: 4,
      flaggedConversations: 1,
      unreadByKind: { client: 3 },
      totalConversations: 42_657,
      totalByKind: { client: 42_423, team: 234 },
      archivedConversations: 2,
      totalsRecountedAt: T1,
    });
  });

  it('setTotals SETs only the total attributes, leaving the badge untouched', async () => {
    const { repo, sent } = makeRepo();
    await repo.setTotals({ totalConversations: 42_657, totalByKind: { client: 42_423, team: 234 }, archivedConversations: 2 }, T1);

    expect(sent[0].name).toBe('UpdateCommand');
    const input = sent[0].input;
    expect(input.Key).toEqual({ PK: 'INBOX#COUNTERS', SK: 'METADATA' });
    // A SET, never a Put: unreadConversations / flaggedConversations are not
    // named anywhere in this write, so a live inbox keeps its badge.
    expect(input.UpdateExpression.startsWith('SET ')).toBe(true);
    const written = Object.values(input.ExpressionAttributeNames) as string[];
    expect(written).not.toContain('unreadConversations');
    expect(written).not.toContain('flaggedConversations');
    expect(written.some((n) => n.startsWith('unreadKind_'))).toBe(false);
    expect(input.ExpressionAttributeValues[':total']).toBe(42_657);
    expect(input.ExpressionAttributeValues[':archived']).toBe(2);
    expect(input.ExpressionAttributeValues[':totalkind_client']).toBe(42_423);
    // Every kind is written, so a category that emptied goes back to 0 rather
    // than keeping a stale number from the last recount.
    expect(input.ExpressionAttributeValues[':totalkind_unknown']).toBe(0);
    expect(input.ExpressionAttributeValues[':recountedAt']).toBe(T1);
  });

  it('set writes the totals and the stamp when the caller did count them', async () => {
    const { repo, sent } = makeRepo();
    await repo.set(
      {
        unreadConversations: 1,
        flaggedConversations: 0,
        unreadByKind: { client: 1 },
        totalConversations: 9,
        totalByKind: { client: 9 },
        archivedConversations: 3,
      },
      T1,
    );
    expect(sent[0].input.Item).toMatchObject({
      totalConversations: 9,
      totalKind_client: 9,
      totalKind_team: 0,
      archivedConversations: 3,
      totalsRecountedAt: T1,
    });
  });
});
