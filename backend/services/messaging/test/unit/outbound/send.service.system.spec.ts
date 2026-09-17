import { RecipientOptedOutException, SendService, type SystemSendInput } from '../../../src/outbound/send.service';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

function makeService(opts: {
  optedOut?: boolean;
  append?: { duplicate: boolean; existing?: { conversationId: string; messageSk: string } };
  enqueue?: Error;
  contactConversation?: ReturnType<typeof createMockConversation> | null;
  emailConfigured?: boolean;
} = {}) {
  const conversations = {
    get: jest.fn(async () => null),
    getByParty: jest.fn(async () => opts.contactConversation ?? null),
    getByAddress: jest.fn(async () => null),
    findOrCreate: jest.fn(async (input: { conversation: unknown }) => ({ conversation: input.conversation, created: true })),
    putReadMarker: jest.fn(async () => undefined),
  };
  const messages = {
    appendOutbound: jest.fn(async (input: { conversation: unknown }) => ({ duplicate: false, conversation: input.conversation, ...(opts.append ?? {}) })),
    getBySk: jest.fn(async () => createMockMessage({ id: 'first', direction: 'outbound', status: 'sent' })),
    updateStatus: jest.fn(async () => true),
  };
  const optOuts = { isOptedOut: jest.fn(async () => opts.optedOut ?? false) };
  const sender = { resolve: jest.fn(async () => ({ from: '+15550001111', source: 'area' })) };
  const queue = { enqueue: jest.fn(async () => { if (opts.enqueue) throw opts.enqueue; return 'queued'; }) };
  const deals = { find: jest.fn(async () => null) };
  const crm = { getContact: jest.fn(async () => ({ id: 'ct1', phones: ['+14045551234'], emails: ['a@x.co'] })), findByPhone: jest.fn(async () => null) };
  const events = { conversationUpdated: jest.fn(async () => undefined), messageReceived: jest.fn(async () => undefined) };
  const realtime = { messageUpserted: jest.fn(), teamCountersInvalidated: jest.fn() };
  const users = { find: jest.fn(async () => ({ id: 'disp-1', name: 'Dana Dispatch' })) };
  const email = {
    configured: opts.emailConfigured ?? true,
    resolve: jest.fn(async (conversationId: string) => ({
      from: 'office@surelock.test',
      fromHeader: 'Sure Lock <office@surelock.test>',
      replyTo: `c-${conversationId}@reply.surelock.test`,
    })),
  };
  const push = { notifyNewMessage: jest.fn(async () => 1) };
  const service = new SendService(
    conversations as any, messages as any, optOuts as any, sender as any, queue as any, deals as any, crm as any, events as any,
    undefined, realtime as any, users as any, undefined, email as any, push as any,
  );
  return { service, conversations, messages, optOuts, sender, queue, events, realtime, crm, users, email, push };
}

/** The technician's team thread — where every "Send to tech" channel lands. */
const teamThread = () =>
  createMockConversation({
    id: 'c-team',
    kind: 'team',
    partyKind: 'user',
    partyId: 't1',
    addresses: { phones: ['+14045550001'], emails: [] },
  });

const input = (overrides: Partial<SystemSendInput> = {}): SystemSendInput => ({
  conversation: createMockConversation(),
  body: '  New job #1001  ',
  dealId: 'd1',
  origin: 'automation',
  automationRuleId: 'new-job-sms',
  clientMessageId: 'automation:new-job-sms:d1:t1:2026-09-20',
  actorId: 'system:automations',
  ...overrides,
});

describe('SendService.sendSystem', () => {
  it('stores a queued automation message under the deterministic key and enqueues it — no authorisation, no DTO', async () => {
    const { service, messages, queue, sender, optOuts, events, realtime } = makeService();
    const { message, duplicate } = await service.sendSystem(input({ sentByUserId: 't1', templateId: 'tpl' }));

    expect(duplicate).toBe(false);
    expect(message).toMatchObject({
      conversationId: 'c1',
      channel: 'sms',
      direction: 'outbound',
      body: 'New job #1001',
      from: '+15550001111',
      to: '+14045551234',
      businessNumber: '+15550001111',
      senderSource: 'area',
      status: 'queued',
      provider: 'twilio',
      origin: 'automation',
      automationRuleId: 'new-job-sms',
      sentByUserId: 't1',
      dealId: 'd1',
      templateId: 'tpl',
    });
    expect(message).not.toHaveProperty('attachments');
    expect(optOuts.isOptedOut).toHaveBeenCalledWith('sms', '+14045551234');
    expect(sender.resolve).toHaveBeenCalledWith({ requested: undefined, conversation: expect.objectContaining({ id: 'c1' }), dealId: 'd1' });
    expect(messages.appendOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ message, clientMessageId: 'automation:new-job-sms:d1:t1:2026-09-20', createdBy: 'system:automations', at: message.createdAt }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: message.createdAt, messageId: message.id });
    expect(realtime.messageUpserted).toHaveBeenCalled();
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('keeps the opt-out rule: a STOP-listed recipient is refused before anything is written', async () => {
    const { service, messages } = makeService({ optedOut: true });
    await expect(service.sendSystem(input())).rejects.toBeInstanceOf(RecipientOptedOutException);
    expect(messages.appendOutbound).not.toHaveBeenCalled();
  });

  it('answers duplicate: true with the first message when the key was already used', async () => {
    const { service, queue } = makeService({ append: { duplicate: true, existing: { conversationId: 'c1', messageSk: `MSG#${T1}#first` } } });
    const { message, duplicate } = await service.sendSystem(input());
    expect(duplicate).toBe(true);
    expect(message.id).toBe('first');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('honours `to` only among the conversation phones and refuses a blank body', async () => {
    const { service } = makeService();
    await expect(service.sendSystem(input({ to: '+14045559999' }))).rejects.toMatchObject({ status: 400 });
    await expect(service.sendSystem(input({ body: '   ' }))).rejects.toMatchObject({ status: 400 });
    const conversation = createMockConversation({ addresses: { phones: ['+14045551234', '+14045559999'], emails: [] } });
    const { message } = await service.sendSystem(input({ conversation, to: '+14045559999', fromNumber: '+15550002222' }));
    expect(message.to).toBe('+14045559999');
  });

  it('marks the message failed and answers 502 when the queue is unreachable (same as the HTTP path)', async () => {
    const { service, messages } = makeService({ enqueue: new Error('sqs down') });
    await expect(service.sendSystem(input())).rejects.toMatchObject({ status: 502 });
    expect(messages.updateStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'failed', errorCode: 'ENQUEUE_FAILED' }));
  });
});

describe('SendService.sendSystem — channel: in_app (Workiz "Send to tech · In App")', () => {
  it('stores the line `sent` in the technician\'s team thread with no provider and wakes them over SSE', async () => {
    const { service, messages, queue, realtime, events, conversations } = makeService();
    const { message, duplicate } = await service.sendSystem(
      input({
        conversation: teamThread(),
        channel: 'in_app',
        automationRuleId: 'send-to-tech:in_app',
        sentByUserId: 'disp-1',
        clientMessageId: 'send-to-tech:d1:t1:in_app:2026-09-16T10:00:00.000Z',
      }),
    );

    expect(duplicate).toBe(false);
    expect(message).toMatchObject({
      conversationId: 'c-team',
      channel: 'in_app',
      direction: 'outbound',
      body: 'New job #1001',
      status: 'sent',
      origin: 'automation',
      automationRuleId: 'send-to-tech:in_app',
      sentByUserId: 'disp-1',
      sentByName: 'Dana Dispatch',
      dealId: 'd1',
    });
    expect(message.sentAt).toBe(message.createdAt);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ markUnread: false, createdBy: 'system:automations' }));
    // The dispatcher is the sender, so the thread's technician is the recipient.
    expect(realtime.messageUpserted).toHaveBeenCalledWith(message, expect.anything(), message.createdAt, { recipients: ['t1'], mentions: undefined });
    expect(realtime.teamCountersInvalidated).toHaveBeenCalledWith('c-team', ['t1'], message.createdAt);
    expect(events.messageReceived).toHaveBeenCalled();
    // A service has no read marker of its own.
    expect(conversations.putReadMarker).not.toHaveBeenCalled();
  });

  it('answers duplicate: true on a replay and refuses a client thread or a blank body', async () => {
    const dup = makeService({ append: { duplicate: true, existing: { conversationId: 'c-team', messageSk: `MSG#${T1}#first` } } });
    const replayed = await dup.service.sendSystem(input({ conversation: teamThread(), channel: 'in_app' }));
    expect(replayed).toMatchObject({ duplicate: true, message: expect.objectContaining({ id: 'first' }) });

    const { service } = makeService();
    await expect(service.sendSystem(input({ channel: 'in_app' }))).rejects.toMatchObject({ status: 501 });
    await expect(service.sendSystem(input({ conversation: teamThread(), channel: 'in_app', body: '  ' }))).rejects.toMatchObject({ status: 400 });
  });

  it('hands the same line and recipients to the push notifier — SSE reaches a tab, not a pocket', async () => {
    const { service, push } = makeService();
    const { message } = await service.sendSystem(
      input({ conversation: teamThread(), channel: 'in_app', sentByUserId: 'disp-1' }),
    );

    // Unfiltered: who actually has a phone, and whether quiet hours or a
    // STOP cover them, is the notifier's decision, not the send path's.
    expect(push.notifyNewMessage).toHaveBeenCalledWith(message, expect.objectContaining({ id: 'c-team' }), ['t1']);
  });

  it('pushes nothing on a replayed line — the first submit already did', async () => {
    const { service, push } = makeService({
      append: { duplicate: true, existing: { conversationId: 'c-team', messageSk: `MSG#${T1}#first` } },
    });
    await service.sendSystem(input({ conversation: teamThread(), channel: 'in_app' }));
    expect(push.notifyNewMessage).not.toHaveBeenCalled();
  });
});

describe('SendService.sendSystem — channel: email (Workiz "Send to tech · Email")', () => {
  const emailInput = (overrides = {}) =>
    input({
      conversation: teamThread(),
      channel: 'email',
      to: 'Ann@Example.COM',
      subject: '  New job #1001  ',
      automationRuleId: 'send-to-tech:email',
      sentByUserId: 'disp-1',
      clientMessageId: 'send-to-tech:d1:t1:email:2026-09-16T10:00:00.000Z',
      ...overrides,
    });

  it('queues a mail with both bodies, the resolved sender and the thread it belongs to', async () => {
    const { service, queue, optOuts, email, messages } = makeService();
    const { message } = await service.sendSystem(emailInput());

    expect(message).toMatchObject({
      conversationId: 'c-team',
      channel: 'email',
      direction: 'outbound',
      subject: 'New job #1001',
      body: 'New job #1001',
      bodyHtml: '<p>New job #1001</p>',
      from: 'office@surelock.test',
      to: 'ann@example.com',
      contactAddress: 'ann@example.com',
      status: 'queued',
      provider: 'ses',
      origin: 'automation',
      automationRuleId: 'send-to-tech:email',
      sentByUserId: 'disp-1',
      dealId: 'd1',
    });
    expect(optOuts.isOptedOut).toHaveBeenCalledWith('email', 'ann@example.com');
    expect(email.resolve).toHaveBeenCalledWith('c-team');
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'system:automations' }));
    expect(queue.enqueue).toHaveBeenCalled();
  });

  it('answers 501 without MESSAGING_EMAIL_FROM, 422 for an unsubscribed address and 400 without a recipient or subject', async () => {
    await expect(makeService({ emailConfigured: false }).service.sendSystem(emailInput())).rejects.toMatchObject({ status: 501 });
    await expect(makeService({ optedOut: true }).service.sendSystem(emailInput())).rejects.toBeInstanceOf(RecipientOptedOutException);

    const { service } = makeService();
    await expect(service.sendSystem(emailInput({ to: undefined }))).rejects.toMatchObject({ status: 400 });
    await expect(service.sendSystem(emailInput({ subject: ' ' }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('SendService.conversationForContact (public for the automations)', () => {
  it('reuses the contact thread or opens it from CRM', async () => {
    const existing = createMockConversation({ id: 'c-existing' });
    expect((await makeService({ contactConversation: existing }).service.conversationForContact('ct1')).conversation.id).toBe('c-existing');

    const { service, conversations } = makeService();
    const { conversation: opened, created } = await service.conversationForContact('ct1');
    expect(created).toBe(true);
    expect(opened).toMatchObject({ kind: 'client', partyKind: 'contact', partyId: 'ct1', addresses: { phones: ['+14045551234'], emails: ['a@x.co'] } });
    expect(conversations.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ pointer: { kind: 'contact', id: 'ct1' } }));
  });
});
