import { type Conversation, type Message } from '@bitcrm/types';
import { PushNotifier } from '../../../src/push/push-notifier.service';
import { type MessageUpsertedEvent } from '../../../src/realtime/realtime-events';
import { type RenderContext } from '../../../src/templates/render-context';
import { createMockConversation } from '../mocks';

const TECH = { status: 'active', roleId: 'role-technician' };
const USERS: Record<string, Record<string, unknown>> = {
  t1: { id: 't1', ...TECH },
  t2: { id: 't2', ...TECH },
  disp: { id: 'disp', status: 'active', roleId: 'role-dispatcher' },
  sub: { id: 'sub', ...TECH, userType: 'subcontractor' },
};
const TOKENS: Record<string, string[]> = {
  t1: ['ExponentPushToken[t1]'],
  t2: ['ExponentPushToken[t2]'],
  disp: ['ExponentPushToken[disp]'],
  sub: ['ExponentPushToken[sub]'],
};

const fresh = () => new Date().toISOString();

const message = (over: Partial<Message> = {}): Message =>
  ({
    id: 'm1',
    conversationId: 'c1',
    channel: 'sms',
    direction: 'inbound',
    body: 'Gate code is 4512',
    status: 'received',
    origin: 'contact',
    createdAt: fresh(),
    updatedAt: fresh(),
    ...over,
  }) as Message;

const teamThread = createMockConversation({ id: 'team-t1', kind: 'team', partyKind: 'user', partyId: 't1' });
const groupThread = createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', name: 'Dispatch', memberIds: ['t1', 't2', 'disp', 'sub'] });
const clientThread = createMockConversation({ id: 'c1', kind: 'client', partyKind: 'contact', partyId: 'ct1', lastDealId: 'd1' });

function jobCtx(deal: RenderContext['deal'] = {}, extra: Partial<RenderContext> = {}): RenderContext {
  return {
    deal: { id: 'd1', dealNumber: '1042', assignedTechIds: ['t1', 't2'], superStatus: 'in_progress', status: 'active', ...deal },
    contact: { firstName: 'Jane', lastName: 'Doe' },
    timezone: 'America/New_York',
    ...extra,
  };
}

function harness(opts: { ctx?: RenderContext; claim?: boolean; stored?: Conversation | null } = {}) {
  const repository = {
    claim: jest.fn(async () => opts.claim ?? true),
    tokensFor: jest.fn(async (userId: string) => (TOKENS[userId] ?? []).map((token) => ({ token, userId, platform: 'ios', createdAt: 'x', updatedAt: 'x' }))),
    unregister: jest.fn(async () => undefined),
  };
  const expo = { send: jest.fn(async (messages: unknown[]) => messages.map(() => ({ status: 'ok', id: 'x' }))) };
  const peers = { user: jest.fn(async (id: string) => USERS[id] ?? null) };
  const context = { load: jest.fn(async () => opts.ctx ?? jobCtx()) };
  const conversations = { get: jest.fn(async () => opts.stored ?? null) };
  const notifier = new PushNotifier({ enabled: true }, repository as any, expo as any, peers as any, context as any, conversations as any);
  const sent = () => expo.send.mock.calls.flatMap((c) => c[0]) as Array<{ to: string; title: string; body: string; data: unknown }>;
  return { notifier, repository, expo, peers, context, conversations, sent };
}

const upserted = (m: Message, conversation?: Conversation): MessageUpsertedEvent => ({ type: 'message.upserted', at: fresh(), message: m, conversation });

describe('PushNotifier — a message in the technician’s team thread', () => {
  it('the office writing in-app → the technician, titled "Office"', async () => {
    const { notifier, sent, repository } = harness();
    const m = message({ id: 'm7', conversationId: 'team-t1', channel: 'in_app', direction: 'outbound', origin: 'user', sentByUserId: 'disp', sentByName: 'Dana Dispatch', body: 'Call me when free' });

    const result = await notifier.onMessageUpserted(upserted(m, teamThread));

    expect(repository.claim).toHaveBeenCalledWith('message#m7');
    expect(sent()).toEqual([
      { to: 'ExponentPushToken[t1]', title: 'Office', body: 'Call me when free', data: { type: 'message', conversationId: 'team-t1' }, sound: 'default', priority: 'high' },
    ]);
    expect(result.recipients).toEqual({ t1: 'sent' });
  });

  it('carries the job when the line names one ("Send to tech")', async () => {
    const { notifier, sent } = harness();
    await notifier.onMessageUpserted(upserted(message({ conversationId: 'team-t1', channel: 'in_app', direction: 'outbound', origin: 'automation', sentByUserId: 'disp', dealId: 'd9' }), teamThread));
    expect(sent()[0].data).toEqual({ type: 'message', conversationId: 'team-t1', dealId: 'd9' });
  });

  it("never pushes the technician's own line back to them", async () => {
    const own = harness();
    const result = await own.notifier.onMessageUpserted(upserted(message({ conversationId: 'team-t1', channel: 'in_app', direction: 'inbound', origin: 'employee', sentByUserId: 't1' }), teamThread));
    expect(result.skipped).toBe('own_message');
    expect(own.repository.claim).not.toHaveBeenCalled();
    expect(own.expo.send).not.toHaveBeenCalled();
  });

  it('an SMS to their personal phone is not pushed again (the phone already rang)', async () => {
    const { notifier, expo } = harness();
    const result = await notifier.onMessageUpserted(upserted(message({ conversationId: 'team-t1', channel: 'sms', direction: 'outbound', origin: 'automation' }), teamThread));
    expect(result.skipped).toBe('not_pushable');
    expect(expo.send).not.toHaveBeenCalled();
  });

  it('an office person’s own team thread is not pushed (office roles: not in this version)', async () => {
    const officeThread = createMockConversation({ id: 'team-disp', kind: 'team', partyKind: 'user', partyId: 'disp' });
    const { notifier, sent } = harness();
    const result = await notifier.onMessageUpserted(upserted(message({ conversationId: 'team-disp', channel: 'in_app', direction: 'outbound', origin: 'user', sentByUserId: 'owner' }), officeThread));
    expect(sent()).toEqual([]);
    expect(result.recipients).toEqual({ disp: 'not_field_team' });
  });
});

describe('PushNotifier — a group line', () => {
  it('goes to the field-team members but the author; titled with the author and the group', async () => {
    const { notifier, sent } = harness();
    const result = await notifier.onMessageUpserted(
      upserted(message({ conversationId: 'g1', channel: 'in_app', direction: 'outbound', origin: 'user', sentByUserId: 't2', sentByName: 'Tom Two', body: 'Who has a 5-pin?' }), groupThread),
    );

    expect(sent().map((m) => m.to)).toEqual(['ExponentPushToken[t1]']);
    expect(sent()[0]).toMatchObject({ title: 'Tom Two · Dispatch', body: 'Who has a 5-pin?', data: { type: 'message', conversationId: 'g1' } });
    expect(result.recipients).toEqual({ t1: 'sent', disp: 'not_field_team', sub: 'subcontractor' });
  });
});

describe('PushNotifier — a client writing in', () => {
  it("→ the technicians on the client's job, titled with the client's name", async () => {
    const { notifier, sent, context } = harness();
    await notifier.onMessageUpserted(upserted(message({ id: 'm3' }), clientThread));

    expect(context.load).toHaveBeenCalledWith({ conversationId: 'c1', dealId: undefined });
    expect(sent().map((m) => m.to)).toEqual(['ExponentPushToken[t1]', 'ExponentPushToken[t2]']);
    expect(sent()[0]).toMatchObject({ title: 'Jane Doe', body: 'Gate code is 4512', data: { type: 'message', conversationId: 'c1', dealId: 'd1' } });
  });

  it('a company thread is titled with the company; a nameless party is "Client"', async () => {
    const company = createMockConversation({ id: 'c2', kind: 'client', partyKind: 'company', partyId: 'co1', lastDealId: 'd1' });
    const named = harness({ ctx: jobCtx({}, { company: { title: 'Acme LLC' } }) });
    await named.notifier.onMessageUpserted(upserted(message({ conversationId: 'c2' }), company));
    expect(named.sent()[0].title).toBe('Acme LLC');

    const nameless = harness({ ctx: jobCtx({}, { contact: undefined }) });
    await nameless.notifier.onMessageUpserted(upserted(message(), clientThread));
    expect(nameless.sent()[0].title).toBe('Client');
  });

  it('the body is cut at 140 characters', async () => {
    const { notifier, sent } = harness();
    await notifier.onMessageUpserted(upserted(message({ body: 'x'.repeat(400) }), clientThread));
    expect(sent()[0].body).toHaveLength(140);
  });

  it('not for our own outbound texts, a closed job, a thread with no job, or a status update of an old line', async () => {
    const outbound = harness();
    expect((await outbound.notifier.onMessageUpserted(upserted(message({ direction: 'outbound', origin: 'user', sentByUserId: 't1' }), clientThread))).skipped).toBe('not_pushable');

    const closed = harness({ ctx: jobCtx({ superStatus: 'done' }) });
    expect((await closed.notifier.onMessageUpserted(upserted(message(), clientThread))).skipped).toBe('closed_deal');

    const jobless = harness({ ctx: { contact: { firstName: 'Jane' } } });
    expect((await jobless.notifier.onMessageUpserted(upserted(message(), clientThread))).skipped).toBe('no_deal');

    const stale = harness();
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    expect((await stale.notifier.onMessageUpserted(upserted(message({ createdAt: old }), clientThread))).skipped).toBe('stale');
    expect(stale.repository.claim).not.toHaveBeenCalled();
  });

  it('portal notes and empty lines are not pushed; unknown numbers neither', async () => {
    const { notifier, expo } = harness();
    expect((await notifier.onMessageUpserted(upserted(message({ channel: 'note', origin: 'system', body: undefined, subject: 'Viewed estimate #12' }), clientThread))).skipped).toBe('not_pushable');
    expect((await notifier.onMessageUpserted(upserted(message({ body: '  ' }), clientThread))).skipped).toBe('not_pushable');
    const unknown = createMockConversation({ id: 'u1', kind: 'unknown', partyKind: 'none', partyId: undefined });
    expect((await notifier.onMessageUpserted(upserted(message({ conversationId: 'u1' }), unknown))).skipped).toBe('not_pushable');
    expect(expo.send).not.toHaveBeenCalled();
  });
});

describe('PushNotifier — message delivery rules', () => {
  it('every messaging task hears the frame; only the one that claims it pushes', async () => {
    const { notifier, expo, context } = harness({ claim: false });
    expect((await notifier.onMessageUpserted(upserted(message(), clientThread))).skipped).toBe('duplicate');
    expect(context.load).not.toHaveBeenCalled();
    expect(expo.send).not.toHaveBeenCalled();
  });

  it('a status update of an outbound text or email (no conversation on the frame) costs no read at all', async () => {
    const { notifier, conversations, repository } = harness({ stored: clientThread });
    for (const channel of ['sms', 'email'] as const) {
      expect((await notifier.onMessageUpserted(upserted(message({ channel, direction: 'outbound', origin: 'user', status: 'delivered' })))).skipped).toBe('not_pushable');
    }
    expect(conversations.get).not.toHaveBeenCalled();
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('reads the conversation when the frame does not carry it', async () => {
    const { notifier, conversations, sent } = harness({ stored: clientThread });
    await notifier.onMessageUpserted(upserted(message()));
    expect(conversations.get).toHaveBeenCalledWith('c1');
    expect(sent()).toHaveLength(2);

    const missing = harness({ stored: null });
    expect((await missing.notifier.onMessageUpserted(upserted(message()))).skipped).toBe('no_conversation');
  });

  it('never throws', async () => {
    const { notifier, conversations } = harness();
    conversations.get.mockRejectedValueOnce(new Error('throttled'));
    await expect(notifier.onMessageUpserted(upserted(message()))).resolves.toMatchObject({ skipped: 'failed' });
    await expect(notifier.onMessageUpserted({ type: 'message.upserted', at: 'x' } as any)).resolves.toMatchObject({ skipped: 'malformed' });
  });
});
