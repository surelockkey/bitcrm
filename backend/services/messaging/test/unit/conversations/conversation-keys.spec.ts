import {
  buildConversationUpdate,
  conversationIndexKeys,
  conversationItem,
  countersDelta,
  toConversation,
} from '../../../src/conversations/conversation-keys';
import { T0, T1, createMockConversation } from '../mocks';

describe('conversationIndexKeys (design §3.1)', () => {
  it('puts an open, read, unflagged conversation in GSI1 and GSI3 only', () => {
    const keys = conversationIndexKeys(createMockConversation({ lastMessageAt: T1 }));
    expect(keys).toEqual({
      GSI1PK: 'INBOX#open#2026',
      GSI1SK: `${T1}#c1`,
      GSI3PK: 'CAT#client#2026',
      GSI3SK: `${T1}#c1`,
    });
  });

  it('adds the sparse keys for unread, flagged and categorised', () => {
    const keys = conversationIndexKeys(
      createMockConversation({ lastMessageAt: T1, unread: true, flagged: true, categoryId: '151892', kind: 'team' }),
    );
    expect(keys).toEqual({
      GSI1PK: 'INBOX#open#2026',
      GSI1SK: `${T1}#c1`,
      GSI2PK: 'UNREAD#2026',
      GSI2SK: `${T1}#c1`,
      GSI3PK: 'CAT#team#2026',
      GSI3SK: `${T1}#c1`,
      GSI5PK: 'FLAG#conversation',
      GSI5SK: `${T1}#c1`,
      GSI6PK: 'ACCTCAT#151892#2026',
      GSI6SK: `${T1}#c1`,
    });
  });

  it('moves an archived conversation to INBOX#archived and out of the open-only indexes', () => {
    const keys = conversationIndexKeys(
      createMockConversation({ lastMessageAt: T1, state: 'archived', unread: true, flagged: true, categoryId: 'x' }),
    );
    expect(keys).toEqual({
      GSI1PK: 'INBOX#archived#2026',
      GSI1SK: `${T1}#c1`,
      // flagged survives archiving; unread / category / account-category do not
      GSI5PK: 'FLAG#conversation',
      GSI5SK: `${T1}#c1`,
    });
  });

  it('buckets by the year of the last message, falling back to createdAt', () => {
    expect(conversationIndexKeys(createMockConversation({ createdAt: '2019-03-01T00:00:00.000Z' })).GSI1PK)
      .toBe('INBOX#open#2019');
    expect(conversationIndexKeys(createMockConversation({ lastMessageAt: '2024-12-31T23:59:59.999Z' })).GSI1PK)
      .toBe('INBOX#open#2024');
  });

  it('builds the full Put item and reads it back without key attributes', () => {
    const c = createMockConversation({ lastMessageAt: T1, workizName: '' });
    const item = conversationItem(c);
    expect(item.PK).toBe('CONV#c1');
    expect(item.SK).toBe('METADATA');
    expect(item.GSI1PK).toBe('INBOX#open#2026');
    expect('workizName' in item).toBe(false); // empty strings are never written

    const back = toConversation(item);
    expect(back).toEqual({ ...c, workizName: undefined });
    expect('PK' in back).toBe(false);
    expect('GSI1PK' in back).toBe(false);
  });
});

describe('buildConversationUpdate (design §3.5)', () => {
  it('SETs present fields, REMOVEs absent sparse keys, always touches updatedAt', () => {
    const next = createMockConversation({ state: 'archived', archivedAt: T1, archivedBy: 'u1', updatedAt: T1 });
    const expr = buildConversationUpdate(next, ['state', 'archivedAt', 'archivedBy']);

    expect(expr.UpdateExpression).toBe(
      'SET #state = :state, #archivedAt = :archivedAt, #archivedBy = :archivedBy, #updatedAt = :updatedAt, ' +
        '#GSI1PK = :GSI1PK, #GSI1SK = :GSI1SK ' +
        'REMOVE #GSI2PK, #GSI2SK, #GSI3PK, #GSI3SK, #GSI5PK, #GSI5SK, #GSI6PK, #GSI6SK',
    );
    expect(expr.ExpressionAttributeNames['#GSI1PK']).toBe('GSI1PK');
    expect(expr.ExpressionAttributeValues).toEqual({
      ':state': 'archived',
      ':archivedAt': T1,
      ':archivedBy': 'u1',
      ':updatedAt': T1,
      ':GSI1PK': 'INBOX#archived#2026',
      ':GSI1SK': `${T0}#c1`,
    });
  });

  it('REMOVEs a field that is cleared and never SETs an empty string', () => {
    const next = createMockConversation({ categoryId: undefined, assignedUserId: '' as unknown as string });
    const expr = buildConversationUpdate(next, ['categoryId', 'assignedUserId']);
    expect(expr.UpdateExpression).toContain('REMOVE #categoryId, #assignedUserId');
    expect(expr.ExpressionAttributeValues).not.toHaveProperty(':categoryId');
  });

  it('turns unreadCount into an atomic ADD when asked', () => {
    const next = createMockConversation({ unread: true, unreadCount: 3, lastMessageAt: T1 });
    const expr = buildConversationUpdate(next, ['unread', 'unreadCount'], { addUnreadCount: 1 });
    expect(expr.UpdateExpression).toMatch(/^SET #unread = :unread, #updatedAt = :updatedAt, /);
    expect(expr.UpdateExpression).toContain(' ADD #unreadCount :unreadInc');
    expect(expr.UpdateExpression).not.toContain('#unreadCount = :unreadCount');
    expect(expr.ExpressionAttributeValues[':unreadInc']).toBe(1);
    expect(expr.ExpressionAttributeValues[':GSI2PK']).toBe('UNREAD#2026');
  });
});

describe('countersDelta', () => {
  it('is empty when neither unread nor flagged changed', () => {
    const c = createMockConversation();
    expect(countersDelta(c, { ...c, categoryId: 'x' })).toBeUndefined();
  });

  it('counts a conversation becoming unread, per kind', () => {
    const c = createMockConversation({ kind: 'team' });
    expect(countersDelta(c, { ...c, unread: true })).toEqual({
      unreadConversations: 1,
      unreadByKind: { team: 1 },
    });
  });

  it('uncounts a thread that is read, leaving the category totals alone', () => {
    // Reading changes the badge only: the conversation is still open and
    // still in the same category, so the column number must not move.
    const c = createMockConversation({ unread: true });
    expect(countersDelta(c, { ...c, unread: false })).toEqual({
      unreadConversations: -1,
      unreadByKind: { client: -1 },
    });
  });

  it('moves an archived thread out of the open totals and into the archived one', () => {
    const c = createMockConversation({ unread: true });
    expect(countersDelta(c, { ...c, state: 'archived' })).toEqual({
      unreadConversations: -1,
      unreadByKind: { client: -1 },
      totalConversations: -1,
      totalByKind: { client: -1 },
      archivedConversations: 1,
    });
  });

  it('brings an unarchived thread back into the open totals', () => {
    const archived = createMockConversation({ state: 'archived' });
    expect(countersDelta(archived, { ...archived, state: 'open' })).toEqual({
      totalConversations: 1,
      totalByKind: { client: 1 },
      archivedConversations: -1,
    });
  });

  it('moves the per-kind count when an unread conversation changes kind', () => {
    const c = createMockConversation({ unread: true, kind: 'unknown' });
    expect(countersDelta(c, { ...c, kind: 'client' })).toEqual({
      unreadByKind: { unknown: -1, client: 1 },
      totalByKind: { unknown: -1, client: 1 },
    });
  });

  it('moves only the totals sideways when a READ conversation changes kind', () => {
    const c = createMockConversation({ unread: false, kind: 'unknown' });
    expect(countersDelta(c, { ...c, kind: 'client' })).toEqual({
      totalByKind: { unknown: -1, client: 1 },
    });
  });

  it('moves nothing when an ARCHIVED conversation changes kind', () => {
    // Archived rows are not in `totalByKind` at all, so there is nothing to
    // move sideways; `archivedConversations` is not per-kind.
    const c = createMockConversation({ state: 'archived', kind: 'unknown' });
    expect(countersDelta(c, { ...c, kind: 'client' })).toBeUndefined();
  });

  it('keeps every conversation in exactly one of open and archived', () => {
    // The invariant the column depends on: an archive is a -1/+1 move, never
    // a double count and never a drop.
    const c = createMockConversation();
    const archive = countersDelta(c, { ...c, state: 'archived' })!;
    expect((archive.totalConversations ?? 0) + (archive.archivedConversations ?? 0)).toBe(0);
    const create = countersDelta(undefined, c)!;
    expect((create.totalConversations ?? 0) + (create.archivedConversations ?? 0)).toBe(1);
  });

  it('tracks the flagged counter independently', () => {
    const c = createMockConversation();
    expect(countersDelta(c, { ...c, flagged: true })).toEqual({ flaggedConversations: 1 });
    expect(countersDelta({ ...c, flagged: true }, c)).toEqual({ flaggedConversations: -1 });
  });

  it('treats a brand-new conversation as counted from nothing', () => {
    expect(countersDelta(undefined, createMockConversation({ unread: true, flagged: true }))).toEqual({
      unreadConversations: 1,
      unreadByKind: { client: 1 },
      flaggedConversations: 1,
      totalConversations: 1,
      totalByKind: { client: 1 },
    });
  });

  it('counts a brand-new READ conversation into the totals even though no badge moves', () => {
    // This is the import-shaped case, and the reason `create()` now carries a
    // counters Update at all: nothing is unread, but the category grew by one.
    expect(countersDelta(undefined, createMockConversation({ unread: false }))).toEqual({
      totalConversations: 1,
      totalByKind: { client: 1 },
    });
  });

  it('counts a conversation created straight into the archive as archived only', () => {
    expect(countersDelta(undefined, createMockConversation({ state: 'archived' }))).toEqual({
      archivedConversations: 1,
    });
  });
});
