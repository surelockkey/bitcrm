import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Conversation } from '@bitcrm/types';
import { ConversationsRepository, StaleConversationError } from 'src/conversations/conversations.repository';
import { InboxCountersRepository } from 'src/counters/inbox-counters.repository';
import {
  MESSAGING_TEST_TABLE,
  clearTestTable,
  createTestTables,
  destroyRawClient,
  getTestDynamoDbClient,
} from './setup';

/**
 * Real DynamoDB Local (:8001, `docker compose --profile test up -d dynamodb-test`):
 *   npm run test:integration -w backend/services/messaging
 * Exercises the year-bucketed indexes, the sparse-key rewrites and the
 * counters transactions that the unit specs only assert the shape of.
 */
describe('ConversationsRepository (integration)', () => {
  let repo: ConversationsRepository;
  let counters: InboxCountersRepository;
  const NOW = new Date('2026-09-15T12:00:00.000Z');

  const conv = (id: string, lastMessageAt: string, overrides: Partial<Conversation> = {}): Conversation => ({
    id,
    kind: 'client',
    partyKind: 'contact',
    partyId: `ct-${id}`,
    addresses: { phones: [], emails: [] },
    state: 'open',
    unread: false,
    unreadCount: 0,
    flagged: false,
    lastMessageAt,
    createdAt: lastMessageAt,
    updatedAt: lastMessageAt,
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTables();
    const dynamo = { client: getTestDynamoDbClient() } as unknown as DynamoDbService;
    repo = new ConversationsRepository(dynamo);
    counters = new InboxCountersRepository(dynamo);
    (repo as any).tableName = MESSAGING_TEST_TABLE;
    (counters as any).tableName = MESSAGING_TEST_TABLE;
  });

  /**
   * The raw `INBOX#COUNTERS` item. `counters.get()` deliberately hides the
   * `total*` attributes until a recount has stamped `totalsRecountedAt`, so
   * asserting that the live ADDs move them takes a direct read.
   */
  const rawCounters = async (): Promise<Record<string, any>> => {
    const res = await getTestDynamoDbClient().send(
      new GetCommand({ TableName: MESSAGING_TEST_TABLE, Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' } }),
    );
    return res.Item ?? {};
  };

  afterAll(() => destroyRawClient());

  beforeEach(async () => {
    await clearTestTable(MESSAGING_TEST_TABLE);
  });

  it('round-trips a conversation and refuses a duplicate id', async () => {
    const c = conv('c1', '2026-09-01T10:00:00.000Z', { categoryId: '151892', workizName: 'Unknown caller' });
    await repo.create(c);
    expect(await repo.get('c1')).toEqual(c);
    await expect(repo.create(c)).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
  });

  it('findOrCreate is idempotent per party and routes the addresses', async () => {
    const first = await repo.findOrCreate({
      conversation: conv('c1', '2026-09-01T10:00:00.000Z'),
      pointer: { kind: 'contact', id: 'ct-1' },
      addresses: [{ address: '+14045551234', source: 'crm' }],
    });
    const second = await repo.findOrCreate({
      conversation: conv('c2', '2026-09-02T10:00:00.000Z'),
      pointer: { kind: 'contact', id: 'ct-1' },
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ conversation: first.conversation, created: false });
    expect(await repo.get('c2')).toBeNull();
    expect(await repo.getByParty('contact', 'ct-1')).toEqual(first.conversation);
    expect(await repo.getByAddress('+14045551234')).toMatchObject({ conversationId: 'c1', partyKind: 'contact', source: 'crm' });
  });

  it('lists the open inbox newest first across year partitions with a working cursor', async () => {
    await repo.create(conv('c-2026a', '2026-03-01T00:00:00.000Z'));
    await repo.create(conv('c-2026b', '2026-08-01T00:00:00.000Z'));
    await repo.create(conv('c-2025', '2025-12-31T00:00:00.000Z'));
    await repo.create(conv('c-2024', '2024-01-01T00:00:00.000Z'));
    await repo.create(conv('c-arch', '2026-09-01T00:00:00.000Z', { state: 'archived' }));

    const page1 = await repo.listInbox({ view: 'all' }, { limit: 3, now: NOW });
    expect(page1.items.map((c) => c.id)).toEqual(['c-2026b', 'c-2026a', 'c-2025']);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await repo.listInbox({ view: 'all' }, { limit: 3, cursor: page1.nextCursor, now: NOW });
    expect(page2.items.map((c) => c.id)).toEqual(['c-2024']);
    expect(page2.nextCursor).toBeUndefined();

    const archived = await repo.listInbox({ view: 'archived' }, { limit: 10, now: NOW });
    expect(archived.items.map((c) => c.id)).toEqual(['c-arch']);
  });

  it('keeps the sparse indexes and counters in step through unread → read → flag → archive', async () => {
    const c = conv('c1', '2026-09-01T10:00:00.000Z', { unread: true, unreadCount: 2 });
    // `create` now carries the counters ADD itself — both halves, the unread
    // badge and the category totals — so the test must not add them by hand.
    await repo.create(c);
    expect(await counters.get()).toMatchObject({ unreadConversations: 1, unreadByKind: { client: 1 } });
    expect(await rawCounters()).toMatchObject({ totalConversations: 1, totalKind_client: 1 });

    expect((await repo.listInbox({ view: 'unread' }, { limit: 10, now: NOW })).items.map((x) => x.id)).toEqual(['c1']);

    const read = await repo.markRead(c, 'u1', { lastReadMessageSk: 'MSG#x' });
    expect((await repo.listInbox({ view: 'unread' }, { limit: 10, now: NOW })).items).toEqual([]);
    expect(await repo.getReadMarker('c1', 'u1')).toMatchObject({ userId: 'u1', lastReadMessageSk: 'MSG#x' });
    expect(await counters.get()).toEqual({ unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} });

    const flagged = await repo.update(read, { flagged: true }, { actorId: 'u1' });
    expect((await repo.listInbox({ view: 'flagged' }, { limit: 10, now: NOW })).items.map((x) => x.id)).toEqual(['c1']);
    expect((await counters.get()).flaggedConversations).toBe(1);

    const archived = await repo.update(flagged, { state: 'archived' }, { actorId: 'u1' });
    expect(archived).toMatchObject({ state: 'archived', archivedBy: 'u1', flagged: true });
    // Archiving moves the conversation between the two totals, never drops it.
    expect(await rawCounters()).toMatchObject({ totalConversations: 0, totalKind_client: 0, archivedConversations: 1 });
    expect((await repo.listInbox({ view: 'all' }, { limit: 10, now: NOW })).items).toEqual([]);
    expect((await repo.listInbox({ view: 'all', kind: 'client' }, { limit: 10, now: NOW })).items).toEqual([]);
    expect((await repo.listInbox({ view: 'archived' }, { limit: 10, now: NOW })).items.map((x) => x.id)).toEqual(['c1']);
    // flagged survives archiving
    expect((await repo.listInbox({ view: 'flagged' }, { limit: 10, now: NOW })).items.map((x) => x.id)).toEqual(['c1']);
    expect(await repo.get('c1')).toEqual(archived);
  });

  it('rejects an update built from a stale read', async () => {
    const c = conv('c1', '2026-09-01T10:00:00.000Z');
    await repo.create(c);
    await repo.update(c, { categoryId: 'x' });
    await expect(repo.update(c, { categoryId: 'y' })).rejects.toBeInstanceOf(StaleConversationError);
  });
});
