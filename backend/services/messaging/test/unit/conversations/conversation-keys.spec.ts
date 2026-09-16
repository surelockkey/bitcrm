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

  it('uncounts an unread conversation that is archived or read', () => {
    const c = createMockConversation({ unread: true });
    expect(countersDelta(c, { ...c, state: 'archived' })).toEqual({
      unreadConversations: -1,
      unreadByKind: { client: -1 },
    });
    expect(countersDelta(c, { ...c, unread: false })).toEqual({
      unreadConversations: -1,
      unreadByKind: { client: -1 },
    });
  });

  it('moves the per-kind count when an unread conversation changes kind', () => {
    const c = createMockConversation({ unread: true, kind: 'unknown' });
    expect(countersDelta(c, { ...c, kind: 'client' })).toEqual({
      unreadByKind: { unknown: -1, client: 1 },
    });
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
    });
  });
});
