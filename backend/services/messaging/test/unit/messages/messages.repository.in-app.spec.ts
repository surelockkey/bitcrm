import { MessagesRepository } from '../../../src/messages/messages.repository';
import { T0, T1, createMockConversation, createMockMessage, mockDynamo } from '../mocks';

/**
 * `appendOutbound({ markUnread })` — the in-app line an employee writes on
 * their own team thread (design §6): stored under the CLIENTMSG# guard like
 * any outbound, but it rolls `unread` forward and moves the counters like
 * an inbound would.
 */
function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new MessagesRepository(dynamo), sent };
}

const AT = '2026-09-15T10:05:01.000Z';
const TEAM = createMockConversation({ id: 'c-u2', kind: 'team', partyKind: 'user', partyId: 'u2', addresses: { phones: [], emails: [] } });
const inApp = createMockMessage({
  id: 'm1', conversationId: 'c-u2', channel: 'in_app', direction: 'inbound', origin: 'employee', status: 'sent',
  from: undefined, to: undefined, businessNumber: undefined, provider: undefined, providerSid: undefined, sentByUserId: 'u2',
});

describe('MessagesRepository.appendOutbound with markUnread', () => {
  it('adds unread=true, ADD unreadCount 1 and the counters item to the transaction', async () => {
    const { repo, sent } = makeRepo();
    const res = await repo.appendOutbound({ message: inApp, clientMessageId: 'cm-1', createdBy: 'u2', conversation: TEAM, at: AT, markUnread: true });

    expect(res.duplicate).toBe(false);
    expect(res.conversation).toMatchObject({ unread: true, unreadCount: 1, lastMessageId: 'm1', lastChannel: 'in_app', lastDirection: 'inbound', updatedAt: AT });
    const items = sent[0].input.TransactItems;
    expect(items).toHaveLength(4);
    expect(items[0].Put.Item).toMatchObject({ PK: 'CLIENTMSG#cm-1', SK: 'METADATA', conversationId: 'c-u2', messageSk: `MSG#${T1}#m1`, createdBy: 'u2' });
    expect(items[1].Put.Item).toMatchObject({ PK: 'CONV#c-u2', SK: `MSG#${T1}#m1`, channel: 'in_app', status: 'sent' });
    expect(items[2].Update.UpdateExpression).toContain('#unread = :unread');
    expect(items[2].Update.UpdateExpression).toContain('ADD #unreadCount :unreadInc');
    expect(items[2].Update.ExpressionAttributeValues).toMatchObject({ ':unread': true, ':unreadInc': 1, ':GSI2PK': 'UNREAD#2026', ':expectedUpdatedAt': T0 });
    expect(items[3].Update).toMatchObject({
      Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' },
      UpdateExpression: 'ADD #unread :unread, #kind_team :kind_team',
      ExpressionAttributeValues: { ':unread': 1, ':kind_team': 1 },
    });
  });

  it('without markUnread the shape is the plain outbound one (three items, no unread)', async () => {
    const { repo, sent } = makeRepo();
    const res = await repo.appendOutbound({ message: { ...inApp, direction: 'outbound', origin: 'user' }, clientMessageId: 'cm-2', createdBy: 'u1', conversation: TEAM, at: AT });
    expect(res.conversation.unread).toBe(false);
    const items = sent[0].input.TransactItems;
    expect(items).toHaveLength(3);
    expect(items[2].Update.UpdateExpression).not.toContain('#unread = :unread');
    expect(items[2].Update.UpdateExpression).not.toContain('ADD');
  });

  it('skips the counters item when the office already had the thread unread', async () => {
    const { repo, sent } = makeRepo();
    const res = await repo.appendOutbound({ message: inApp, clientMessageId: 'cm-3', createdBy: 'u2', conversation: { ...TEAM, unread: true, unreadCount: 2 }, at: AT, markUnread: true });
    expect(sent[0].input.TransactItems).toHaveLength(3);
    expect(res.conversation.unreadCount).toBe(3);
  });
});
