import { ConflictException, NotFoundException } from '@nestjs/common';
import { type Message, type ResolvedPermissions } from '@bitcrm/types';
import { RESENDABLE_STATUSES, RecipientOptedOutException, SendService } from '../../../src/outbound/send.service';
import { createMockConversation, createMockMessage, T0, T1 } from '../mocks';

const CM = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';
const user = { id: 'u1', cognitoSub: 's', email: 'u1@x.co', roleId: 'r1', department: 'ops' };
const caller = () => ({ user, perms: perms() });

function perms(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    roleId: 'r1',
    roleName: 'Dispatcher',
    isSystemRole: false,
    permissions: { messages: { view: true, send: true, manage: true }, team_chat: { view: true, send: true, manage_groups: false } } as never,
    dataScope: { messages: 'all', team_chat: 'all' } as never,
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

/** A failed outbound SMS as the feed holds it. */
const failed = (over: Partial<Message> = {}): Message =>
  createMockMessage({
    id: 'm-fail',
    direction: 'outbound',
    channel: 'sms',
    status: 'failed',
    body: 'Your key is ready',
    from: '+15550001111',
    to: '+14045551234',
    businessNumber: '+15550001111',
    senderSource: 'agent',
    providerSid: 'SMfail',
    errorCode: '21408',
    errorMessage: 'Sending to this region is not enabled on the account',
    origin: 'automation',
    sentByUserId: 'u9',
    automationRuleId: 'new-job-sms',
    dealId: 'd1',
    templateId: 't1',
    segments: 1,
    attachments: [
      { id: 'a1', fileName: 'door.jpg', contentType: 'image/jpeg', size: 10, status: 'stored', s3Key: 'messaging/uploads/u9/a1' },
      { id: 'a2', fileName: 'gone.jpg', contentType: 'image/jpeg', status: 'pending' },
    ],
    createdAt: T0,
    sentAt: T0,
    updatedAt: T1,
    ...over,
  });

const failedEmail = (over: Partial<Message> = {}): Message =>
  failed({
    id: 'e-fail',
    channel: 'email',
    provider: 'ses',
    providerSid: '<ses-1>',
    subject: 'Your invoice',
    body: 'Hi Jane, your invoice',
    bodyHtml: '<p>Hi Jane, your invoice</p>',
    from: 'old@example.com',
    to: 'jane@example.com',
    contactAddress: 'jane@example.com',
    businessNumber: undefined,
    senderSource: undefined,
    inReplyTo: '<root@mail.example.com>',
    references: ['<root@mail.example.com>'],
    errorCode: 'Bounce',
    errorMessage: 'Mailbox full',
    ...over,
  });

function makeService(opts: {
  conversation?: ReturnType<typeof createMockConversation> | null;
  /** What the feed pages hold (each entry one page, in order). */
  feed?: Message[][];
  /** What `get` answers when the caller sends createdAt. */
  byKey?: Message | null;
  optedOut?: boolean;
  sender?: { from?: string; source: string };
  append?: { duplicate: boolean; existing?: { conversationId: string; messageSk: string } };
  /** `CLIENTMSG#` keys already taken. */
  taken?: string[];
  email?: { configured: boolean; resolve: jest.Mock };
  deal?: Record<string, unknown> | null;
  /** Jobs by id, when the conversation's latest and the line's differ. */
  deals?: Record<string, Record<string, unknown>>;
} = {}) {
  const conversation = opts.conversation === undefined ? createMockConversation({ lastDealId: 'd1' }) : opts.conversation;
  const pages = opts.feed ?? [[failed()]];
  const conversations = { get: jest.fn(async () => conversation) };
  const messages = {
    get: jest.fn(async () => (opts.byKey === undefined ? null : opts.byKey)),
    listByConversation: jest.fn(async (_id: string, o: { limit: number; cursor?: string }) => {
      const index = o.cursor ? Number(o.cursor.replace('page-', '')) : 0;
      const items = pages[index] ?? [];
      return { items, nextCursor: index + 1 < pages.length ? `page-${index + 1}` : undefined };
    }),
    getClientMessagePointer: jest.fn(async (id: string) => ((opts.taken ?? []).includes(id) ? { clientMessageId: id } : null)),
    appendOutbound: jest.fn(async (input: { conversation: unknown }) => ({ duplicate: false, conversation: input.conversation, ...(opts.append ?? {}) })),
    getBySk: jest.fn(async () => createMockMessage({ id: 'first', direction: 'outbound', status: 'queued', resentFromMessageId: 'm-fail' })),
    markResent: jest.fn(async () => undefined),
    updateStatus: jest.fn(async () => true),
  };
  const optOuts = { isOptedOut: jest.fn(async () => opts.optedOut ?? false) };
  const sender = { resolve: jest.fn(async () => opts.sender ?? { from: '+15550002222', source: 'sticky' }) };
  const queue = { enqueue: jest.fn(async () => 'queued') };
  const deals = { find: jest.fn(async (id: string) => (opts.deals ? opts.deals[id] ?? null : opts.deal ?? null)) };
  const crm = { getContact: jest.fn(async () => null), findByPhone: jest.fn(async () => null) };
  const events = { conversationUpdated: jest.fn(async () => undefined), messageReceived: jest.fn(async () => undefined) };
  const realtime = { messageUpserted: jest.fn(), conversationUpserted: jest.fn(), countersChanged: jest.fn(), teamCountersInvalidated: jest.fn() };
  const service = new SendService(
    conversations as any,
    messages as any,
    optOuts as any,
    sender as any,
    queue as any,
    deals as any,
    crm as any,
    events as any,
    undefined,
    realtime as any,
    undefined,
    undefined,
    opts.email as any,
  );
  return { service, conversations, messages, optOuts, sender, queue, deals, events, realtime };
}

const emailReady = () => ({
  configured: true,
  resolve: jest.fn(async () => ({ from: 'office@example.com', fromHeader: '"Sure Lock" <office@example.com>', replyTo: 'c-c1@reply.example.com' })),
});

describe('SendService.resend — what may be resent', () => {
  it('only an outbound line the provider gave up on: failed, undelivered, canceled', () => {
    expect(RESENDABLE_STATUSES).toEqual(['failed', 'undelivered', 'canceled']);
  });

  it('409s on a line that is not failed (sent, delivered, still sending), inbound, or in-app — nothing is written', async () => {
    for (const source of [
      failed({ status: 'delivered' }),
      failed({ status: 'sent' }),
      failed({ status: 'sending' }),
      failed({ status: 'queued' }),
      createMockMessage({ id: 'm-fail', direction: 'inbound', status: 'received' }),
      failed({ channel: 'in_app', status: 'sent', provider: undefined }),
      failed({ channel: 'note', provider: undefined }),
    ]) {
      const { service, messages, sender } = makeService({ feed: [[source]] });
      const err = await service.resend('c1', 'm-fail', {}, caller()).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getStatus()).toBe(409);
      expect(messages.appendOutbound).not.toHaveBeenCalled();
      expect(sender.resolve).not.toHaveBeenCalled();
    }
  });

  it('undelivered and canceled lines may be resent too', async () => {
    for (const status of ['undelivered', 'canceled'] as const) {
      const { service } = makeService({ feed: [[failed({ status })]] });
      await expect(service.resend('c1', 'm-fail', {}, caller())).resolves.toMatchObject({ status: 'queued', resentFromMessageId: 'm-fail' });
    }
  });

  it('404s on an unknown conversation or message', async () => {
    await expect(makeService({ conversation: null }).service.resend('nope', 'm-fail', {}, caller())).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeService({ feed: [[createMockMessage({ id: 'other' })]] }).service.resend('c1', 'm-fail', {}, caller())).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeService({ byKey: null }).service.resend('c1', 'm-fail', { createdAt: T0 }, caller())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the send rules: assigned_only callers only for jobs they are on, team threads need team_chat.send', async () => {
    const scoped = perms({ dataScope: { messages: 'assigned_only' } as never });
    await expect(makeService({ deal: { id: 'd1', assignedTechIds: ['u9'] } }).service.resend('c1', 'm-fail', {}, { user, perms: scoped })).rejects.toMatchObject({ status: 403 });
    await expect(makeService({ deal: { id: 'd1', assignedTechIds: ['u1'] } }).service.resend('c1', 'm-fail', {}, { user, perms: scoped })).resolves.toMatchObject({ status: 'queued' });

    const team = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'u2', addresses: { phones: ['+14045551234'], emails: [] } });
    const noTeam = perms({ permissions: { messages: { view: true, send: true, manage: true }, team_chat: { view: true, send: false } } as never });
    await expect(makeService({ conversation: team }).service.resend('c1', 'm-fail', {}, { user, perms: noTeam })).rejects.toMatchObject({ status: 403 });
  });

  it('checks the scope on the conversation before the line is looked up: outside it, 403 — never a 404 or 409 that says what exists', async () => {
    const scoped = perms({ dataScope: { messages: 'assigned_only' } as never });
    const offJob = { id: 'd1', assignedTechIds: ['u9'] };

    const missing = makeService({ deal: offJob, feed: [[createMockMessage({ id: 'other' })]] });
    await expect(missing.service.resend('c1', 'm-fail', {}, { user, perms: scoped })).rejects.toMatchObject({ status: 403 });
    expect(missing.messages.listByConversation).not.toHaveBeenCalled();
    expect(missing.messages.get).not.toHaveBeenCalled();

    const delivered = makeService({ deal: offJob, byKey: failed({ status: 'delivered' }) });
    await expect(delivered.service.resend('c1', 'm-fail', { createdAt: T0 }, { user, perms: scoped })).rejects.toMatchObject({ status: 403 });
    expect(delivered.messages.get).not.toHaveBeenCalled();

    const team = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'u2', addresses: { phones: ['+14045551234'], emails: [] } });
    const noTeam = perms({ permissions: { messages: { view: true, send: true, manage: true }, team_chat: { view: true, send: false } } as never });
    const thread = makeService({ conversation: team, feed: [[createMockMessage({ id: 'other' })]] });
    await expect(thread.service.resend('c1', 'm-fail', {}, { user, perms: noTeam })).rejects.toMatchObject({ status: 403 });
    expect(thread.messages.listByConversation).not.toHaveBeenCalled();
  });

  it('assigned_only is re-checked against the line’s own job when it is not the conversation’s latest', async () => {
    const scoped = perms({ dataScope: { messages: 'assigned_only' } as never });
    const conversation = createMockConversation({ lastDealId: 'd2' });

    // on the conversation's latest job, not on the line's: refused, both jobs read, nothing written
    const offLine = makeService({ conversation, deals: { d2: { id: 'd2', assignedTechIds: ['u1'] }, d1: { id: 'd1', assignedTechIds: ['u9'] } } });
    await expect(offLine.service.resend('c1', 'm-fail', {}, { user, perms: scoped })).rejects.toMatchObject({ status: 403 });
    expect(offLine.deals.find.mock.calls.map((c) => c[0])).toEqual(['d2', 'd1']);
    expect(offLine.messages.appendOutbound).not.toHaveBeenCalled();

    // on both: goes out, with the line's job
    const onBoth = makeService({ conversation, deals: { d2: { id: 'd2', assignedTechIds: ['u1'] }, d1: { id: 'd1', assignedTechIds: ['u1'] } } });
    await expect(onBoth.service.resend('c1', 'm-fail', {}, { user, perms: scoped })).resolves.toMatchObject({ status: 'queued', dealId: 'd1' });

    // the same job as the conversation's latest: one read
    const same = makeService({ deal: { id: 'd1', assignedTechIds: ['u1'] } });
    await same.service.resend('c1', 'm-fail', {}, { user, perms: scoped });
    expect(same.deals.find).toHaveBeenCalledTimes(1);
  });
});

describe('SendService.resend — already resent', () => {
  const copyOf = (status: Message['status']) =>
    createMockMessage({ id: 'm-copy', direction: 'outbound', channel: 'sms', status, resentFromMessageId: 'm-fail', createdAt: T1 });

  it('409s "Message was already resent" when the original points at a copy that is queued, on its way or delivered — nothing written', async () => {
    for (const status of ['queued', 'sending', 'sent', 'delivered', 'read'] as const) {
      const { service, messages, sender, optOuts } = makeService({ feed: [[copyOf(status), failed({ resentAsMessageId: 'm-copy' })]] });
      const err = await service.resend('c1', 'm-fail', {}, caller()).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getStatus()).toBe(409);
      expect(err.message).toBe('Message was already resent');
      expect(optOuts.isOptedOut).not.toHaveBeenCalled();
      expect(sender.resolve).not.toHaveBeenCalled();
      expect(messages.appendOutbound).not.toHaveBeenCalled();
      expect(messages.markResent).not.toHaveBeenCalled();
    }
  });

  it('lets the original go out again when its copy failed too, or when the copy is nowhere in the recent feed', async () => {
    for (const status of ['failed', 'undelivered', 'canceled'] as const) {
      const { service, messages } = makeService({ feed: [[copyOf(status), failed({ resentAsMessageId: 'm-copy' })]] });
      await expect(service.resend('c1', 'm-fail', {}, caller())).resolves.toMatchObject({ status: 'queued', resentFromMessageId: 'm-fail' });
      expect(messages.markResent).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm-fail' }), expect.any(String), expect.any(String));
    }

    const gone = makeService({ byKey: failed({ resentAsMessageId: 'm-copy' }), feed: [[]] });
    await expect(gone.service.resend('c1', 'm-fail', { createdAt: T0 }, caller())).resolves.toMatchObject({ status: 'queued', resentFromMessageId: 'm-fail' });
    expect(gone.messages.get).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: T0, messageId: 'm-fail' });
    expect(gone.messages.listByConversation).toHaveBeenCalledWith('c1', { limit: 50, cursor: undefined });
  });

  it('a failed copy can itself be resent — the chain goes on from the newest failure', async () => {
    const copy = failed({ id: 'm-copy', resentFromMessageId: 'm-fail', createdAt: T1 });
    const { service, messages } = makeService({ feed: [[copy, failed({ resentAsMessageId: 'm-copy' })]] });
    await expect(service.resend('c1', 'm-copy', {}, caller())).resolves.toMatchObject({ status: 'queued', resentFromMessageId: 'm-copy' });
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: 'resend:m-copy:1' }));
    expect(messages.markResent).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm-copy' }), expect.any(String), expect.any(String));
  });
});

describe('SendService.resend — the copy', () => {
  it('SMS: a NEW queued line with the same text, attachments, job, template and recipient; the sender re-resolved; linked both ways; the normal accept path', async () => {
    const { service, messages, sender, optOuts, queue, realtime, events } = makeService();
    const m = await service.resend('c1', 'm-fail', {}, caller());

    expect(m).toMatchObject({
      conversationId: 'c1',
      channel: 'sms',
      direction: 'outbound',
      body: 'Your key is ready',
      from: '+15550002222',
      to: '+14045551234',
      businessNumber: '+15550002222',
      senderSource: 'sticky',
      status: 'queued',
      provider: 'twilio',
      origin: 'user',
      sentByUserId: 'u1',
      dealId: 'd1',
      templateId: 't1',
      attachments: [{ id: 'a1', fileName: 'door.jpg', contentType: 'image/jpeg', size: 10, status: 'stored', s3Key: 'messaging/uploads/u9/a1' }],
      resentFromMessageId: 'm-fail',
    });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.id).not.toBe('m-fail');
    expect(m.createdAt).toBe(m.updatedAt);
    expect(m.createdAt > T1).toBe(true);
    for (const stale of ['providerSid', 'errorCode', 'errorMessage', 'segments', 'sentAt', 'automationRuleId', 'resentAsMessageId'] as const) {
      expect(m[stale]).toBeUndefined();
    }
    expect(m.attachments).not.toBe(failed().attachments);

    expect(optOuts.isOptedOut).toHaveBeenCalledWith('sms', '+14045551234');
    expect(sender.resolve).toHaveBeenCalledWith({ requested: '+15550001111', conversation: expect.objectContaining({ id: 'c1' }), dealId: 'd1' });
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ message: m, clientMessageId: 'resend:m-fail:1', createdBy: 'u1', at: m.createdAt }));
    expect(queue.enqueue).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: m.createdAt, messageId: m.id });
    expect(messages.markResent).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: T0, messageId: 'm-fail' }, m.id, m.createdAt);
    expect(realtime.messageUpserted).toHaveBeenCalledWith(m, expect.objectContaining({ id: 'c1' }), m.createdAt);
    expect(realtime.messageUpserted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-fail', status: 'failed', resentAsMessageId: m.id, updatedAt: m.createdAt }),
      undefined,
      m.createdAt,
    );
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('falls back to the original number when the sender chain yields none, and texts an employee from the workspace number (no job)', async () => {
    const pool = makeService({ sender: { source: 'pool' } });
    const m = await pool.service.resend('c1', 'm-fail', {}, caller());
    expect(m).toMatchObject({ from: '+15550001111', businessNumber: '+15550001111', senderSource: 'agent' });

    const team = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'u2', addresses: { phones: ['+14045551234'], emails: [] }, lastDealId: 'd1' });
    const employee = makeService({ conversation: team });
    await employee.service.resend('c1', 'm-fail', {}, caller());
    expect(employee.sender.resolve).toHaveBeenCalledWith(expect.objectContaining({ dealId: undefined }));
  });

  it('email: subject, both bodies, threading headers and recipient kept, the sender address as resolved now, provider ses', async () => {
    const email = emailReady();
    const withEmail = createMockConversation({ addresses: { phones: [], emails: ['jane@example.com'] } });
    const { service, messages, optOuts, sender } = makeService({ conversation: withEmail, feed: [[failedEmail()]], email });
    const m = await service.resend('c1', 'e-fail', {}, caller());

    expect(m).toMatchObject({
      channel: 'email',
      direction: 'outbound',
      subject: 'Your invoice',
      body: 'Hi Jane, your invoice',
      bodyHtml: '<p>Hi Jane, your invoice</p>',
      from: 'office@example.com',
      to: 'jane@example.com',
      contactAddress: 'jane@example.com',
      inReplyTo: '<root@mail.example.com>',
      references: ['<root@mail.example.com>'],
      status: 'queued',
      provider: 'ses',
      origin: 'user',
      sentByUserId: 'u1',
      dealId: 'd1',
      templateId: 't1',
      resentFromMessageId: 'e-fail',
    });
    expect(m.businessNumber).toBeUndefined();
    expect(m.errorCode).toBeUndefined();
    expect(optOuts.isOptedOut).toHaveBeenCalledWith('email', 'jane@example.com');
    expect(email.resolve).toHaveBeenCalledWith('c1');
    expect(sender.resolve).not.toHaveBeenCalled();
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: 'resend:e-fail:1' }));

    const unconfigured = makeService({ feed: [[failedEmail()]], email: { configured: false, resolve: jest.fn(async () => null) } });
    await expect(unconfigured.service.resend('c1', 'e-fail', {}, caller())).rejects.toMatchObject({ status: 501 });
    const noSender = makeService({ feed: [[failedEmail({ from: undefined })]], email: { configured: true, resolve: jest.fn(async () => null) } });
    await expect(noSender.service.resend('c1', 'e-fail', {}, caller())).rejects.toMatchObject({ status: 501 });
  });

  it('refuses an opted-out recipient with 422 RECIPIENT_OPTED_OUT before the sender or the table are touched', async () => {
    const { service, messages, sender } = makeService({ optedOut: true });
    const err = await service.resend('c1', 'm-fail', {}, caller()).catch((e) => e);
    expect(err).toBeInstanceOf(RecipientOptedOutException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toMatch(/^RECIPIENT_OPTED_OUT: \+14045551234/);
    expect(sender.resolve).not.toHaveBeenCalled();
    expect(messages.appendOutbound).not.toHaveBeenCalled();
    expect(messages.markResent).not.toHaveBeenCalled();

    const email = makeService({ feed: [[failedEmail()]], email: emailReady(), optedOut: true });
    await expect(email.service.resend('c1', 'e-fail', {}, caller())).rejects.toMatchObject({ status: 422 });
  });

  it('a line with nothing to send is refused with 409', async () => {
    await expect(makeService({ feed: [[failed({ body: undefined, attachments: undefined })]] }).service.resend('c1', 'm-fail', {}, caller())).rejects.toMatchObject({ status: 409 });
    await expect(makeService({ feed: [[failed({ to: undefined })]] }).service.resend('c1', 'm-fail', {}, caller())).rejects.toMatchObject({ status: 409 });
    await expect(makeService({ feed: [[failedEmail({ subject: undefined })]], email: emailReady() }).service.resend('c1', 'e-fail', {}, caller())).rejects.toMatchObject({ status: 409 });
  });
});

describe('SendService.resend — idempotency', () => {
  it('uses the composer’s clientMessageId as-is, and returns the first copy on a repeat without sending or linking again', async () => {
    const { service, messages } = makeService();
    await service.resend('c1', 'm-fail', { clientMessageId: CM }, caller());
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: CM }));
    expect(messages.getClientMessagePointer).not.toHaveBeenCalled();

    const repeat = makeService({ append: { duplicate: true, existing: { conversationId: 'c1', messageSk: `MSG#${T1}#first` } } });
    const m = await repeat.service.resend('c1', 'm-fail', { clientMessageId: CM }, caller());
    expect(m.id).toBe('first');
    expect(repeat.messages.getBySk).toHaveBeenCalledWith('c1', `MSG#${T1}#first`);
    expect(repeat.queue.enqueue).not.toHaveBeenCalled();
    expect(repeat.messages.markResent).not.toHaveBeenCalled();
    expect(repeat.realtime.messageUpserted).not.toHaveBeenCalled();
  });

  it('mints resend:<messageId>:<n>, n = previous resends + 1 as the CLIENTMSG# pointers count them', async () => {
    const first = makeService();
    await first.service.resend('c1', 'm-fail', {}, caller());
    expect(first.messages.getClientMessagePointer).toHaveBeenCalledWith('resend:m-fail:1');
    expect(first.messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: 'resend:m-fail:1' }));

    const third = makeService({ taken: ['resend:m-fail:1', 'resend:m-fail:2'] });
    await third.service.resend('c1', 'm-fail', {}, caller());
    expect(third.messages.getClientMessagePointer.mock.calls.map((c) => c[0])).toEqual(['resend:m-fail:1', 'resend:m-fail:2', 'resend:m-fail:3']);
    expect(third.messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: 'resend:m-fail:3' }));
  });

  it('a double click: both requests compute the same key, the second lands on the guard and gets the first copy', async () => {
    const { service, messages, queue } = makeService();
    messages.appendOutbound
      .mockImplementationOnce(async (input: any) => ({ duplicate: false, conversation: input.conversation }))
      .mockImplementationOnce(async (input: any) => ({ duplicate: true, conversation: input.conversation, existing: { conversationId: 'c1', messageSk: `MSG#${T1}#first` } }));
    const [a, b] = await Promise.all([service.resend('c1', 'm-fail', {}, caller()), service.resend('c1', 'm-fail', {}, caller())]);
    expect(messages.appendOutbound.mock.calls.map((c: any) => c[0].clientMessageId)).toEqual(['resend:m-fail:1', 'resend:m-fail:1']);
    expect(b.id).toBe('first');
    expect(a.id).not.toBe('first');
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(messages.markResent).toHaveBeenCalledTimes(1);
  });

  it('gives up with 409 when every probe slot is taken', async () => {
    const taken = Array.from({ length: 100 }, (_, i) => `resend:m-fail:${i + 1}`);
    const { service, messages } = makeService({ taken });
    await expect(service.resend('c1', 'm-fail', {}, caller())).rejects.toMatchObject({ status: 409 });
    expect(messages.appendOutbound).not.toHaveBeenCalled();
  });
});

describe('SendService.resend — finding the line and the link', () => {
  it('reads the line directly when createdAt is given, else walks the recent feed (at most four pages of 50)', async () => {
    const direct = makeService({ byKey: failed() });
    await direct.service.resend('c1', 'm-fail', { createdAt: T0 }, caller());
    expect(direct.messages.get).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: T0, messageId: 'm-fail' });
    expect(direct.messages.listByConversation).not.toHaveBeenCalled();

    const deep = makeService({ feed: [[createMockMessage({ id: 'x' })], [createMockMessage({ id: 'y' })], [failed()]] });
    await deep.service.resend('c1', 'm-fail', {}, caller());
    expect(deep.messages.listByConversation.mock.calls.map((c) => c[1])).toEqual([
      { limit: 50, cursor: undefined },
      { limit: 50, cursor: 'page-1' },
      { limit: 50, cursor: 'page-2' },
    ]);

    const tooDeep = makeService({ feed: [[], [], [], [], [failed()]] });
    await expect(tooDeep.service.resend('c1', 'm-fail', {}, caller())).rejects.toBeInstanceOf(NotFoundException);
    expect(tooDeep.messages.listByConversation).toHaveBeenCalledTimes(4);
  });

  it('a failure to mark the original costs the link, never the send', async () => {
    const { service, messages, realtime, queue } = makeService();
    messages.markResent.mockRejectedValueOnce(new Error('dynamo'));
    const m = await service.resend('c1', 'm-fail', {}, caller());
    expect(m.status).toBe('queued');
    expect(queue.enqueue).toHaveBeenCalled();
    expect(realtime.messageUpserted).toHaveBeenCalledTimes(1); // the copy only
    expect(realtime.messageUpserted).toHaveBeenCalledWith(m, expect.anything(), m.createdAt);
  });
});
