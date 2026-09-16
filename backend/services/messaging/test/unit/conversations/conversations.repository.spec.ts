import {
  ConversationsRepository,
  StaleConversationError,
  UnsupportedInboxFilterError,
  applyPatch,
} from '../../../src/conversations/conversations.repository';
import { conversationItem } from '../../../src/conversations/conversation-keys';
import { decodeCursor, encodeCursor } from '../../../src/common/cursor';
import {
  NOW,
  T0,
  T1,
  conditionalCheckFailed,
  createMockConversation,
  mockDynamo,
  transactionCanceled,
} from '../mocks';

/**
 * Asserts the exact commands the repository builds — key shapes, index names,
 * condition expressions, transaction item order — against a scripted client.
 * Real DynamoDB behaviour is covered by the integration spec.
 */
function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new ConversationsRepository(dynamo), sent };
}

describe('ConversationsRepository.create', () => {
  it('puts CONV#<id>/METADATA with the index keys and an existence guard', async () => {
    const { repo, sent } = makeRepo();
    await repo.create(createMockConversation({ lastMessageAt: T1 }));

    // A create always grows a category, so the Put now rides in a transaction
    // with the counters ADD (see the next test).
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('TransactWriteCommand');
    const input = sent[0].input.TransactItems[0].Put;
    expect(input.TableName).toBe('BitCRM_Messaging');
    expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(input.Item).toMatchObject({
      PK: 'CONV#c1',
      SK: 'METADATA',
      id: 'c1',
      GSI1PK: 'INBOX#open#2026',
      GSI1SK: `${T1}#c1`,
      GSI3PK: 'CAT#client#2026',
    });
    expect(input.Item.GSI2PK).toBeUndefined();
    expect(input.Item.GSI5PK).toBeUndefined();
  });

  it('counts the new conversation into the category totals in the same transaction', async () => {
    const { repo, sent } = makeRepo();
    await repo.create(createMockConversation({ unread: true }));

    const items = sent[0].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[1].Update).toMatchObject({
      Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' },
      ExpressionAttributeValues: {
        ':total': 1,
        ':totalkind_client': 1,
        ':unread': 1,
        ':kind_client': 1,
      },
    });
    expect(items[1].Update.UpdateExpression.startsWith('ADD ')).toBe(true);
  });

  it('still reports a duplicate id as ConditionalCheckFailedException, not a cancelled transaction', async () => {
    // The Put grew into a transaction to carry the counters ADD; the existence
    // guard is the whole point of `create`, so the error callers see must not
    // change shape with the number of items in the write.
    const { repo } = makeRepo([transactionCanceled(['ConditionalCheckFailed', 'None'])]);
    await expect(repo.create(createMockConversation())).rejects.toMatchObject({
      name: 'ConditionalCheckFailedException',
    });
  });

  it('rethrows a transaction cancelled for any other reason untouched', async () => {
    const { repo } = makeRepo([transactionCanceled(['None', 'TransactionConflict'])]);
    await expect(repo.create(createMockConversation())).rejects.toMatchObject({
      name: 'TransactionCanceledException',
    });
  });
});

describe('ConversationsRepository.findOrCreate', () => {
  const input = {
    conversation: createMockConversation(),
    pointer: { kind: 'contact' as const, id: 'ct1' },
    addresses: [{ address: '+14045551234', source: 'crm' as const }],
  };

  it('creates pointer, conversation and address rows in one transaction on a miss', async () => {
    const { repo, sent } = makeRepo([{} /* CONVOF miss */, {} /* transaction ok */]);
    const res = await repo.findOrCreate(input);

    expect(res).toEqual({ conversation: input.conversation, created: true });
    expect(sent.map((s) => s.name)).toEqual(['GetCommand', 'TransactWriteCommand']);
    expect(sent[0].input.Key).toEqual({ PK: 'CONVOF#contact#ct1', SK: 'METADATA' });

    const items = sent[1].input.TransactItems;
    // pointer, conversation, address, and the counters ADD last — the pointer
    // must stay at index 0 for the `conditionFailedAt(err, 0)` race check.
    expect(items).toHaveLength(4);
    expect(items[3].Update).toMatchObject({
      Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' },
      ExpressionAttributeValues: { ':total': 1, ':totalkind_client': 1 },
    });
    expect(items[0].Put).toMatchObject({
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: { PK: 'CONVOF#contact#ct1', SK: 'METADATA', pointerKind: 'contact', pointerId: 'ct1', conversationId: 'c1', createdAt: T0 },
    });
    expect(items[1].Put).toMatchObject({
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: { PK: 'CONV#c1', SK: 'METADATA' },
    });
    expect(items[2].Put.Item).toEqual({
      PK: 'ADDR#+14045551234',
      SK: 'METADATA',
      address: '+14045551234',
      conversationId: 'c1',
      partyKind: 'contact',
      partyId: 'ct1',
      source: 'crm',
      updatedAt: T0,
    });
    expect(items[2].Put.ConditionExpression).toBeUndefined();
  });

  it('returns the existing conversation when the pointer already exists', async () => {
    const existing = createMockConversation({ id: 'c-old' });
    const { repo, sent } = makeRepo([
      { Item: { PK: 'CONVOF#contact#ct1', SK: 'METADATA', conversationId: 'c-old' } },
      { Item: conversationItem(existing) },
    ]);
    const res = await repo.findOrCreate(input);

    expect(res).toEqual({ conversation: existing, created: false });
    expect(sent.map((s) => s.name)).toEqual(['GetCommand', 'GetCommand']);
    expect(sent[1].input.Key).toEqual({ PK: 'CONV#c-old', SK: 'METADATA' });
  });

  it('yields to a concurrent creator when the pointer condition trips', async () => {
    const raced = createMockConversation({ id: 'c-raced' });
    const { repo, sent } = makeRepo([
      {},
      transactionCanceled(['ConditionalCheckFailed', 'None', 'None']),
      { Item: { conversationId: 'c-raced' } },
      { Item: conversationItem(raced) },
    ]);
    const res = await repo.findOrCreate(input);
    expect(res).toEqual({ conversation: raced, created: false });
    expect(sent.map((s) => s.name)).toEqual(['GetCommand', 'TransactWriteCommand', 'GetCommand', 'GetCommand']);
  });

  it('rethrows a transaction that failed for any other reason', async () => {
    const { repo } = makeRepo([{}, transactionCanceled(['None', 'ConditionalCheckFailed', 'None'])]);
    await expect(repo.findOrCreate(input)).rejects.toMatchObject({ name: 'TransactionCanceledException' });
  });
});

describe('applyPatch', () => {
  it('derives archivedAt/By when archiving and clears them when reopening', () => {
    const c = createMockConversation();
    const archived = applyPatch(c, { state: 'archived' }, 'u1', T1);
    expect(archived.next).toMatchObject({ state: 'archived', archivedAt: T1, archivedBy: 'u1', updatedAt: T1 });
    expect(archived.fields).toEqual(['state', 'archivedAt', 'archivedBy']);

    const reopened = applyPatch(archived.next, { state: 'open' }, 'u2', T1);
    expect(reopened.next.archivedAt).toBeUndefined();
    expect(reopened.next.archivedBy).toBeUndefined();
  });

  it('resets unreadCount when marking read and ignores no-op values', () => {
    const c = createMockConversation({ unread: true, unreadCount: 4 });
    expect(applyPatch(c, { unread: false }, 'u1', T1).next.unreadCount).toBe(0);
    expect(applyPatch(c, { unread: true }, 'u1', T1).fields).toEqual([]);
    expect(applyPatch(c, {}, 'u1', T1).fields).toEqual([]);
  });

  it('clears optional fields on null', () => {
    const c = createMockConversation({ categoryId: 'x', assignedUserId: 'u9' });
    const { next, fields } = applyPatch(c, { categoryId: null, assignedUserId: null }, 'u1', T1);
    expect(next.categoryId).toBeUndefined();
    expect(next.assignedUserId).toBeUndefined();
    expect(fields).toEqual(['categoryId', 'assignedUserId']);
  });
});

describe('ConversationsRepository.update', () => {
  it('archives with the guarded UpdateItem and the totals move in one transaction', async () => {
    const { repo, sent } = makeRepo();
    const current = createMockConversation({ lastMessageAt: T1 });
    const next = await repo.update(current, { state: 'archived' }, { actorId: 'u1', at: '2026-09-16T00:00:00.000Z' });

    // An archive always moves the category totals (open -1, archived +1) even
    // when the thread was already read, so it is always a transaction now.
    expect(next.state).toBe('archived');
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('TransactWriteCommand');
    const input = sent[0].input.TransactItems[0].Update;
    expect(input.Key).toEqual({ PK: 'CONV#c1', SK: 'METADATA' });
    expect(input.ConditionExpression).toBe('attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt');
    expect(input.ExpressionAttributeValues[':expectedUpdatedAt']).toBe(T0);
    expect(input.ExpressionAttributeValues[':GSI1PK']).toBe('INBOX#archived#2026');
    expect(input.UpdateExpression).toContain('#state = :state');
    expect(input.UpdateExpression).toMatch(/REMOVE .*#GSI2PK, #GSI2SK, #GSI3PK, #GSI3SK/);

    expect(sent[0].input.TransactItems[1].Update.ExpressionAttributeValues).toEqual({
      ':total': -1,
      ':archived': 1,
      ':totalkind_client': -1,
    });
  });

  it('still uses a plain guarded UpdateItem when nothing the counters track moves', async () => {
    const { repo, sent } = makeRepo();
    const current = createMockConversation();
    await repo.update(current, { assignedUserId: 'u9' }, { actorId: 'u1', at: T1 });

    // Assigning moves neither the badge nor a category size — no counters ADD,
    // so the cheap single-item write is preserved.
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('UpdateCommand');
    expect(sent[0].input.Key).toEqual({ PK: 'CONV#c1', SK: 'METADATA' });
  });

  it('moves the unread counters in the same transaction when archiving an unread thread', async () => {
    const { repo, sent } = makeRepo();
    const current = createMockConversation({ unread: true, unreadCount: 2 });
    await repo.update(current, { state: 'archived' }, { actorId: 'u1' });

    expect(sent[0].name).toBe('TransactWriteCommand');
    const [conv, counters] = sent[0].input.TransactItems;
    expect(conv.Update.Key).toEqual({ PK: 'CONV#c1', SK: 'METADATA' });
    expect(conv.Update.ConditionExpression).toContain('#updatedAt = :expectedUpdatedAt');
    expect(counters.Update).toMatchObject({
      Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' },
      UpdateExpression:
        'ADD #unread :unread, #kind_client :kind_client, #total :total, #archived :archived, #totalkind_client :totalkind_client',
      ExpressionAttributeNames: {
        '#unread': 'unreadConversations',
        '#kind_client': 'unreadKind_client',
        '#total': 'totalConversations',
        '#archived': 'archivedConversations',
        '#totalkind_client': 'totalKind_client',
      },
      ExpressionAttributeValues: {
        ':unread': -1,
        ':kind_client': -1,
        ':total': -1,
        ':archived': 1,
        ':totalkind_client': -1,
      },
    });
  });

  it('flags: sets GSI5 and bumps flaggedConversations', async () => {
    const { repo, sent } = makeRepo();
    const next = await repo.update(createMockConversation(), { flagged: true }, { actorId: 'u1', at: T1 });

    expect(next).toMatchObject({ flagged: true, flaggedAt: T1, flaggedBy: 'u1' });
    const [conv, counters] = sent[0].input.TransactItems;
    expect(conv.Update.ExpressionAttributeValues[':GSI5PK']).toBe('FLAG#conversation');
    expect(conv.Update.ExpressionAttributeValues[':GSI5SK']).toBe(`${T0}#c1`);
    expect(counters.Update.UpdateExpression).toBe('ADD #flagged :flagged');
    expect(counters.Update.ExpressionAttributeValues).toEqual({ ':flagged': 1 });
  });

  it('does nothing for an empty patch', async () => {
    const { repo, sent } = makeRepo();
    const current = createMockConversation();
    expect(await repo.update(current, {})).toBe(current);
    expect(sent).toHaveLength(0);
  });

  it('surfaces a lost optimistic lock as StaleConversationError', async () => {
    const { repo } = makeRepo([conditionalCheckFailed()]);
    await expect(repo.update(createMockConversation(), { state: 'archived' })).rejects.toBeInstanceOf(
      StaleConversationError,
    );

    const viaTransaction = makeRepo([transactionCanceled(['ConditionalCheckFailed', 'None'])]);
    await expect(
      viaTransaction.repo.update(createMockConversation({ unread: true }), { state: 'archived' }),
    ).rejects.toBeInstanceOf(StaleConversationError);
  });
});

describe('ConversationsRepository.markRead', () => {
  it('clears unread, writes READ#<userId> and decrements the counters atomically', async () => {
    const { repo, sent } = makeRepo();
    const current = createMockConversation({ unread: true, unreadCount: 3, lastMessageAt: T1 });
    const next = await repo.markRead(current, 'u1', { lastReadMessageSk: `MSG#${T1}#m1`, at: '2026-09-15T11:00:00.000Z' });

    expect(next).toMatchObject({ unread: false, unreadCount: 0 });
    expect(sent[0].name).toBe('TransactWriteCommand');
    const [conv, marker, counters] = sent[0].input.TransactItems;
    expect(conv.Update.UpdateExpression).toContain('#unread = :unread');
    expect(conv.Update.UpdateExpression).toContain('#unreadCount = :unreadCount');
    expect(conv.Update.UpdateExpression).toMatch(/REMOVE .*#GSI2PK, #GSI2SK/);
    expect(conv.Update.ExpressionAttributeValues).toMatchObject({ ':unread': false, ':unreadCount': 0, ':expectedUpdatedAt': T0 });
    expect(marker.Put.Item).toEqual({
      PK: 'CONV#c1',
      SK: 'READ#u1',
      conversationId: 'c1',
      userId: 'u1',
      lastReadAt: '2026-09-15T11:00:00.000Z',
      lastReadMessageSk: `MSG#${T1}#m1`,
    });
    expect(counters.Update.ExpressionAttributeValues).toEqual({ ':unread': -1, ':kind_client': -1 });
  });

  it('still records the marker for an already-read thread, without touching counters', async () => {
    const { repo, sent } = makeRepo();
    await repo.markRead(createMockConversation(), 'u1');
    expect(sent[0].input.TransactItems).toHaveLength(2);
  });
});

describe('ConversationsRepository reads', () => {
  it('get / getPointer / getByAddress / getReadMarker use the documented keys', async () => {
    const { repo, sent } = makeRepo([
      { Item: conversationItem(createMockConversation()) },
      { Item: { PK: 'CONVOF#user#u1', SK: 'METADATA', pointerKind: 'user', pointerId: 'u1', conversationId: 'c1', createdAt: T0 } },
      { Item: { PK: 'ADDR#+14045551234', SK: 'METADATA', address: '+14045551234', conversationId: 'c1', partyKind: 'contact', partyId: 'ct1', source: 'crm', updatedAt: T0 } },
      {},
    ]);

    expect(await repo.get('c1')).toEqual(createMockConversation());
    expect(await repo.getPointer('user', 'u1')).toEqual({ pointerKind: 'user', pointerId: 'u1', conversationId: 'c1', createdAt: T0 });
    expect(await repo.getByAddress('+14045551234')).toMatchObject({ conversationId: 'c1', partyKind: 'contact' });
    expect(await repo.getReadMarker('c1', 'u1')).toBeNull();

    expect(sent.map((s) => s.input.Key)).toEqual([
      { PK: 'CONV#c1', SK: 'METADATA' },
      { PK: 'CONVOF#user#u1', SK: 'METADATA' },
      { PK: 'ADDR#+14045551234', SK: 'METADATA' },
      { PK: 'CONV#c1', SK: 'READ#u1' },
    ]);
  });

  it('putAddressPointer / removeAddressPointer address the ADDR# row', async () => {
    const { repo, sent } = makeRepo();
    await repo.putAddressPointer({ address: 'a@b.co', conversationId: 'c1', partyKind: 'contact', partyId: 'ct1', source: 'manual', updatedAt: T0 });
    await repo.removeAddressPointer('a@b.co');
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toMatchObject({ PK: 'ADDR#a@b.co', SK: 'METADATA', source: 'manual' });
    expect(sent[1].name).toBe('DeleteCommand');
    expect(sent[1].input.Key).toEqual({ PK: 'ADDR#a@b.co', SK: 'METADATA' });
  });
});

describe('ConversationsRepository.listAll (search backfill export)', () => {
  const row = (id: string, at: string, state: 'open' | 'archived' = 'open') =>
    conversationItem(createMockConversation({ id, lastMessageAt: at, state }));
  const YEARS = NOW.getUTCFullYear() - 2015 + 1; // partitions walked per state, current year down to INBOX_MIN_YEAR

  it('walks every INBOX#open#<YYYY> partition, then every INBOX#archived#<YYYY> one — Query only, no Scan', async () => {
    const { repo, sent } = makeRepo([{ Items: [row('c1', T1)] }]);
    const page = await repo.listAll({ limit: 50, now: NOW });

    expect(page.items.map((c) => c.id)).toEqual(['c1']);
    expect(page.nextCursor).toBeUndefined();
    expect(sent).toHaveLength(2 * YEARS);
    expect(new Set(sent.map((s) => s.name))).toEqual(new Set(['QueryCommand']));
    for (const s of sent) {
      expect(s.input.IndexName).toBe('InboxIndex');
      expect(s.input.ExpressionAttributeNames).toEqual({ '#pk': 'GSI1PK' });
      expect(s.input.FilterExpression).toBeUndefined();
    }
    const pks = sent.map((s) => s.input.ExpressionAttributeValues[':pk']);
    expect(pks[0]).toBe('INBOX#open#2026');
    expect(pks[YEARS - 1]).toBe('INBOX#open#2015');
    expect(pks[YEARS]).toBe('INBOX#archived#2026');
    expect(pks[2 * YEARS - 1]).toBe('INBOX#archived#2015');
  });

  it('resumes mid-partition with a { s, y, k } cursor', async () => {
    const lek = { PK: 'CONV#c2', SK: 'METADATA', GSI1PK: 'INBOX#open#2025', GSI1SK: '2025-01-01T00:00:00.000Z#c2' };
    const { repo, sent } = makeRepo([
      { Items: [row('c1', T1)] },
      { Items: [row('c2', '2025-06-01T00:00:00.000Z')], LastEvaluatedKey: lek },
    ]);
    const page = await repo.listAll({ limit: 2, now: NOW });

    expect(page.items.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(sent).toHaveLength(2);
    expect(decodeCursor(page.nextCursor)).toEqual({ s: 'open', y: '2025', k: lek });

    const { repo: repo2, sent: sent2 } = makeRepo([{ Items: [] }]);
    await repo2.listAll({ limit: 2, cursor: page.nextCursor, now: NOW });
    expect(sent2[0].input.ExpressionAttributeValues[':pk']).toBe('INBOX#open#2025');
    expect(sent2[0].input.ExclusiveStartKey).toEqual(lek);
  });

  it('fills one page across the open → archived boundary and carries the state in the cursor', async () => {
    // open: c1 in 2026, nothing older; archived: a1, a2 in 2026 (a2 left for the next page).
    const responses: Array<Record<string, unknown>> = [{ Items: [row('c1', T1)] }];
    for (let i = 1; i < YEARS; i++) responses.push({ Items: [] });
    const lek = { PK: 'CONV#a1', SK: 'METADATA', GSI1PK: 'INBOX#archived#2026', GSI1SK: `${T0}#a1` };
    responses.push({ Items: [row('a1', T0, 'archived')], LastEvaluatedKey: lek });
    const { repo, sent } = makeRepo(responses);

    const page = await repo.listAll({ limit: 2, now: NOW });
    expect(page.items.map((c) => c.id)).toEqual(['c1', 'a1']);
    expect(page.items[1].state).toBe('archived');
    const archivedQuery = sent[YEARS].input;
    expect(archivedQuery.ExpressionAttributeValues[':pk']).toBe('INBOX#archived#2026');
    expect(archivedQuery.Limit).toBe(1);
    expect(decodeCursor(page.nextCursor)).toEqual({ s: 'archived', y: '2026', k: lek });
  });

  it('hands back an archived cursor when the open walk fills the page exactly at its last year', async () => {
    const responses: Array<Record<string, unknown>> = [];
    for (let i = 0; i < YEARS - 1; i++) responses.push({ Items: [] });
    responses.push({ Items: [row('c-old', '2015-03-01T00:00:00.000Z')] });
    const { repo, sent } = makeRepo(responses);

    const page = await repo.listAll({ limit: 1, now: NOW });
    expect(page.items.map((c) => c.id)).toEqual(['c-old']);
    expect(sent).toHaveLength(YEARS); // no archived query yet — the page is full
    expect(decodeCursor(page.nextCursor)).toEqual({ s: 'archived', y: '2026' });

    const { repo: repo2, sent: sent2 } = makeRepo([{ Items: [row('a1', T0, 'archived')] }]);
    const next = await repo2.listAll({ limit: 1, cursor: page.nextCursor, now: NOW });
    expect(next.items.map((c) => c.id)).toEqual(['a1']);
    expect(sent2[0].input.ExpressionAttributeValues[':pk']).toBe('INBOX#archived#2026');
  });

  it('ends without a cursor once the archived partitions are exhausted', async () => {
    const { repo } = makeRepo([]);
    const page = await repo.listAll({ limit: 10, cursor: encodeCursor({ s: 'archived', y: '2016' }), now: NOW });
    expect(page).toEqual({ items: [] });
  });

  it('rejects cursors of the wrong shape', async () => {
    const { repo } = makeRepo();
    for (const bad of [
      encodeCursor({ y: '2025' }), // no state
      encodeCursor({ s: 'unread', y: '2025' }), // not an inbox state
      encodeCursor({ s: 'open' }), // no year
      encodeCursor({ s: 'open', y: '2025', k: 'nope' }), // key is not an object
      '%%%',
    ]) {
      await expect(repo.listAll({ limit: 10, cursor: bad, now: NOW })).rejects.toMatchObject({ name: 'InvalidCursorError' });
    }
  });
});

describe('ConversationsRepository.listInbox', () => {
  const row = (id: string, at: string) => conversationItem(createMockConversation({ id, lastMessageAt: at }));

  it('reads INBOX#open#<current year> on the InboxIndex, newest first, key condition only', async () => {
    const { repo, sent } = makeRepo([{ Items: [row('c1', T1)] }]);
    const page = await repo.listInbox({ view: 'all' }, { limit: 50, now: NOW });

    expect(page.items.map((c) => c.id)).toEqual(['c1']);
    expect(page.nextCursor).toBeUndefined();
    expect(sent.map((s) => s.name)).toEqual(Array(NOW.getUTCFullYear() - 2015 + 1).fill('QueryCommand'));
    expect(sent[0].input).toMatchObject({
      IndexName: 'InboxIndex',
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'GSI1PK' },
      ExpressionAttributeValues: { ':pk': 'INBOX#open#2026' },
      ScanIndexForward: false,
      Limit: 50,
    });
    expect(sent[0].input.FilterExpression).toBeUndefined();
    expect(sent[1].input.ExpressionAttributeValues[':pk']).toBe('INBOX#open#2025');
  });

  it('walks into the previous year to fill the page and returns a resumable cursor', async () => {
    const lek = { PK: 'CONV#c3', SK: 'METADATA', GSI1PK: 'INBOX#open#2025', GSI1SK: '2025-01-01T00:00:00.000Z#c3' };
    const { repo, sent } = makeRepo([
      { Items: [row('c1', T1)] },
      { Items: [row('c2', '2025-06-01T00:00:00.000Z')], LastEvaluatedKey: lek },
    ]);
    const page = await repo.listInbox({ view: 'all' }, { limit: 2, now: NOW });

    expect(page.items.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(sent).toHaveLength(2);
    expect(sent[1].input.Limit).toBe(1);
    expect(decodeCursor(page.nextCursor)).toEqual({ y: '2025', k: lek });

    const { repo: repo2, sent: sent2 } = makeRepo([{ Items: [] }]);
    await repo2.listInbox({ view: 'all' }, { limit: 2, cursor: page.nextCursor, now: NOW });
    expect(sent2[0].input.ExpressionAttributeValues[':pk']).toBe('INBOX#open#2025');
    expect(sent2[0].input.ExclusiveStartKey).toEqual(lek);
  });

  it('routes each tab to its own partition', async () => {
    const cases: Array<[Parameters<ConversationsRepository['listInbox']>[0], string, string, string]> = [
      [{ view: 'unread' }, 'UnreadIndex', 'GSI2PK', 'UNREAD#2026'],
      [{ view: 'archived' }, 'InboxIndex', 'GSI1PK', 'INBOX#archived#2026'],
      [{ view: 'all', kind: 'team' }, 'CategoryIndex', 'GSI3PK', 'CAT#team#2026'],
      [{ view: 'all', categoryId: '151892' }, 'AccountCategoryIndex', 'GSI6PK', 'ACCTCAT#151892#2026'],
    ];
    for (const [query, index, pkAttr, pk] of cases) {
      const { repo, sent } = makeRepo([{ Items: [row('c1', T1)] }]);
      await repo.listInbox(query, { limit: 1, now: NOW });
      expect(sent[0].input.IndexName).toBe(index);
      expect(sent[0].input.ExpressionAttributeNames).toEqual({ '#pk': pkAttr });
      expect(sent[0].input.ExpressionAttributeValues[':pk']).toBe(pk);
    }
  });

  it('reads flagged from the single FLAG#conversation partition with a plain key cursor', async () => {
    const lek = { PK: 'CONV#c1', SK: 'METADATA', GSI5PK: 'FLAG#conversation', GSI5SK: `${T1}#c1` };
    const { repo, sent } = makeRepo([{ Items: [row('c1', T1)], LastEvaluatedKey: lek }, { Items: [] }]);
    const page = await repo.listInbox({ view: 'flagged' }, { limit: 1, now: NOW });

    expect(sent[0].input).toMatchObject({ IndexName: 'FlagIndex', ExpressionAttributeValues: { ':pk': 'FLAG#conversation' } });
    expect(decodeCursor(page.nextCursor)).toEqual({ k: lek });

    await repo.listInbox({ view: 'flagged' }, { limit: 1, cursor: page.nextCursor });
    expect(sent[1].input.ExclusiveStartKey).toEqual(lek);
  });

  it('refuses filter combinations that would need a FilterExpression', async () => {
    const { repo } = makeRepo();
    await expect(repo.listInbox({ view: 'unread', kind: 'client' }, { limit: 10 })).rejects.toBeInstanceOf(
      UnsupportedInboxFilterError,
    );
    await expect(
      repo.listInbox({ view: 'all', kind: 'client', categoryId: 'x' }, { limit: 10 }),
    ).rejects.toBeInstanceOf(UnsupportedInboxFilterError);
  });

  it('rejects a cursor of the wrong shape for the tab', async () => {
    const { repo } = makeRepo();
    await expect(
      repo.listInbox({ view: 'all' }, { limit: 10, cursor: encodeCursor({ k: { PK: 'x' } }) }),
    ).rejects.toMatchObject({ name: 'InvalidCursorError' });
    await expect(
      repo.listInbox({ view: 'flagged' }, { limit: 10, cursor: encodeCursor({ y: '2025' }) }),
    ).rejects.toMatchObject({ name: 'InvalidCursorError' });
  });
});
