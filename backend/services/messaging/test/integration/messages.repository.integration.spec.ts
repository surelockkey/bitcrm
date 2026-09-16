import { DynamoDbService } from '@bitcrm/shared';
import { type Conversation, type Message } from '@bitcrm/types';
import { ConversationsRepository } from 'src/conversations/conversations.repository';
import { InboxCountersRepository } from 'src/counters/inbox-counters.repository';
import { MessagesRepository } from 'src/messages/messages.repository';
import {
  MESSAGING_TEST_TABLE,
  clearTestTable,
  createTestTables,
  destroyRawClient,
  getTestDynamoDbClient,
} from './setup';

/**
 * Real DynamoDB Local (:8001). Covers the append transactions end to end —
 * PSID#/CLIENTMSG# guards, the conversation roll-forward, counters — plus
 * feed / job / flagged paging and the status-rank guard.
 */
describe('MessagesRepository (integration)', () => {
  let messages: MessagesRepository;
  let conversations: ConversationsRepository;
  let counters: InboxCountersRepository;
  const NOW = new Date('2026-09-15T12:00:00.000Z');

  const baseConversation = (): Conversation => ({
    id: 'c1',
    kind: 'client',
    partyKind: 'contact',
    partyId: 'ct1',
    addresses: { phones: ['+14045551234'], emails: [] },
    state: 'open',
    unread: false,
    unreadCount: 0,
    flagged: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  });

  const inbound = (id: string, createdAt: string, overrides: Partial<Message> = {}): Message => ({
    id,
    conversationId: 'c1',
    channel: 'sms',
    direction: 'inbound',
    body: `msg ${id}`,
    from: '+14045551234',
    to: '+15550001111',
    businessNumber: '+15550001111',
    status: 'received',
    provider: 'twilio',
    providerSid: `SM-${id}`,
    origin: 'contact',
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTables();
    const dynamo = { client: getTestDynamoDbClient() } as unknown as DynamoDbService;
    messages = new MessagesRepository(dynamo);
    conversations = new ConversationsRepository(dynamo);
    counters = new InboxCountersRepository(dynamo);
    for (const r of [messages, conversations, counters]) (r as any).tableName = MESSAGING_TEST_TABLE;
  });

  afterAll(() => destroyRawClient());

  beforeEach(async () => {
    await clearTestTable(MESSAGING_TEST_TABLE);
    await conversations.create(baseConversation());
  });

  it('appends inbound messages, rolls the conversation forward and dedups by provider sid', async () => {
    const m1 = inbound('m1', '2026-09-15T10:00:00.000Z', { dealId: 'd1' });
    const first = await messages.appendInbound({ message: m1, conversation: baseConversation() });
    expect(first.duplicate).toBe(false);

    const m2 = inbound('m2', '2026-09-15T10:01:00.000Z');
    const second = await messages.appendInbound({ message: m2, conversation: first.conversation });
    expect(second.duplicate).toBe(false);

    const dup = await messages.appendInbound({ message: m2, conversation: second.conversation });
    expect(dup.duplicate).toBe(true);

    const c = await conversations.get('c1');
    expect(c).toMatchObject({ unread: true, unreadCount: 2, lastMessageId: 'm2', lastMessagePreview: 'msg m2', lastDealId: 'd1', lastBusinessNumber: '+15550001111' });
    expect(await counters.get()).toEqual({ unreadConversations: 1, flaggedConversations: 0, unreadByKind: { client: 1 } });
    expect((await conversations.listInbox({ view: 'unread' }, { limit: 10, now: NOW })).items.map((x) => x.id)).toEqual(['c1']);
    expect(await messages.getByProviderSid('SM-m1')).toEqual(m1);
    expect(await messages.get({ conversationId: 'c1', createdAt: m2.createdAt, messageId: 'm2' })).toEqual(m2);
  });

  it('retries the roll-forward from a fresh read when the passed conversation is stale', async () => {
    const stale = baseConversation();
    await conversations.update(stale, { flagged: true }, { actorId: 'u1' });
    const res = await messages.appendInbound({ message: inbound('m1', '2026-09-15T10:00:00.000Z'), conversation: stale });
    expect(res.duplicate).toBe(false);
    expect(res.conversation.flagged).toBe(true);
    expect(await conversations.get('c1')).toMatchObject({ flagged: true, unread: true, unreadCount: 1, lastMessageId: 'm1' });
  });

  it('pages the feed newest first and the job tab from JobIndex', async () => {
    let c = baseConversation();
    for (let i = 1; i <= 5; i++) {
      const res = await messages.appendInbound({
        message: inbound(`m${i}`, `2026-09-15T10:0${i}:00.000Z`, { dealId: i % 2 ? 'd1' : undefined }),
        conversation: c,
      });
      c = res.conversation;
    }

    const page1 = await messages.listByConversation('c1', { limit: 3 });
    expect(page1.items.map((m) => m.id)).toEqual(['m5', 'm4', 'm3']);
    const page2 = await messages.listByConversation('c1', { limit: 3, cursor: page1.nextCursor });
    expect(page2.items.map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(page2.nextCursor).toBeUndefined();

    const job = await messages.listByJob('d1', { limit: 10 });
    expect(job.items.map((m) => m.id)).toEqual(['m5', 'm3', 'm1']);
  });

  it('guards outbound submits with CLIENTMSG# and applies status callbacks by rank only', async () => {
    const queued: Message = inbound('o1', '2026-09-15T11:00:00.000Z', {
      direction: 'outbound',
      status: 'queued',
      from: '+15550001111',
      to: '+14045551234',
      providerSid: undefined,
      origin: 'user',
      sentByUserId: 'u1',
    });
    const first = await messages.appendOutbound({ message: queued, clientMessageId: 'cm-1', createdBy: 'u1', conversation: baseConversation() });
    expect(first.duplicate).toBe(false);
    const again = await messages.appendOutbound({ message: { ...queued, id: 'o2' }, clientMessageId: 'cm-1', createdBy: 'u1', conversation: first.conversation });
    expect(again.duplicate).toBe(true);
    expect(again.existing).toMatchObject({ conversationId: 'c1', messageSk: `MSG#${queued.createdAt}#o1` });
    expect(await messages.get({ conversationId: 'c1', createdAt: queued.createdAt, messageId: 'o2' })).toBeNull();
    expect(await conversations.get('c1')).toMatchObject({ unread: false, lastDirection: 'outbound', lastMessageId: 'o1' });

    const key = { conversationId: 'c1', createdAt: queued.createdAt, messageId: 'o1' };
    expect(await messages.markSending(key)).toBe(true);
    expect(await messages.markSending(key)).toBe(false);
    expect(await messages.putProviderSidPointer('SM-o1', key)).toBe(true);
    expect(await messages.updateStatus(key, { status: 'delivered', providerSid: 'SM-o1' })).toBe(true);
    // late "sent" and a second terminal status are ignored
    expect(await messages.updateStatus(key, { status: 'sent', providerSid: 'SM-o1' })).toBe(false);
    expect(await messages.updateStatus(key, { status: 'failed', providerSid: 'SM-o1', errorCode: '30003' })).toBe(false);
    // a callback for a different sid never touches this message
    expect(await messages.updateStatus(key, { status: 'read', providerSid: 'SM-other' })).toBe(false);
    expect(await messages.updateStatus(key, { status: 'read', providerSid: 'SM-o1' })).toBe(true);
    expect(await messages.get(key)).toMatchObject({ status: 'read', providerSid: 'SM-o1', sendingStartedAt: expect.any(String) });
    expect(await messages.getByProviderSid('SM-o1')).toMatchObject({ id: 'o1' });
  });

  it('flags messages into FLAG#message#<year> and lists them across years', async () => {
    const c = baseConversation();
    const old = await messages.appendInbound({ message: inbound('m-old', '2025-05-01T00:00:00.000Z'), conversation: c });
    await messages.appendInbound({ message: inbound('m-new', '2026-09-15T10:00:00.000Z'), conversation: old.conversation });

    await messages.setFlagged({ conversationId: 'c1', createdAt: '2025-05-01T00:00:00.000Z', messageId: 'm-old' }, true, 'u1');
    await messages.setFlagged({ conversationId: 'c1', createdAt: '2026-09-15T10:00:00.000Z', messageId: 'm-new' }, true, 'u1');
    expect((await messages.listFlagged({ limit: 10, now: NOW })).items.map((m) => m.id)).toEqual(['m-new', 'm-old']);

    await messages.setFlagged({ conversationId: 'c1', createdAt: '2026-09-15T10:00:00.000Z', messageId: 'm-new' }, false, 'u1');
    expect((await messages.listFlagged({ limit: 10, now: NOW })).items.map((m) => m.id)).toEqual(['m-old']);
  });
});
