import { RecipientOptedOutException, SendService, type SystemSendInput } from '../../../src/outbound/send.service';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

function makeService(opts: {
  optedOut?: boolean;
  append?: { duplicate: boolean; existing?: { conversationId: string; messageSk: string } };
  enqueue?: Error;
  contactConversation?: ReturnType<typeof createMockConversation> | null;
} = {}) {
  const conversations = {
    get: jest.fn(async () => null),
    getByParty: jest.fn(async () => opts.contactConversation ?? null),
    getByAddress: jest.fn(async () => null),
    findOrCreate: jest.fn(async (input: { conversation: unknown }) => ({ conversation: input.conversation, created: true })),
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
  const events = { conversationUpdated: jest.fn(async () => undefined) };
  const realtime = { messageUpserted: jest.fn() };
  const service = new SendService(
    conversations as any, messages as any, optOuts as any, sender as any, queue as any, deals as any, crm as any, events as any, undefined, realtime as any,
  );
  return { service, conversations, messages, optOuts, sender, queue, events, realtime, crm };
}

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

describe('SendService.conversationForContact (public for the automations)', () => {
  it('reuses the contact thread or opens it from CRM', async () => {
    const existing = createMockConversation({ id: 'c-existing' });
    expect((await makeService({ contactConversation: existing }).service.conversationForContact('ct1')).id).toBe('c-existing');

    const { service, conversations } = makeService();
    const opened = await service.conversationForContact('ct1');
    expect(opened).toMatchObject({ kind: 'client', partyKind: 'contact', partyId: 'ct1', addresses: { phones: ['+14045551234'], emails: ['a@x.co'] } });
    expect(conversations.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ pointer: { kind: 'contact', id: 'ct1' } }));
  });
});
