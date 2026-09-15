import { type ResolvedPermissions } from '@bitcrm/types';
import { RecipientOptedOutException, SendService, uploadKey } from '../../../src/outbound/send.service';
import { type SendMessageDto, type StartConversationMessageDto } from '../../../src/outbound/dto/send-message.dto';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

const CM = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';
const user = { id: 'u1', cognitoSub: 's', email: 'u1@x.co', roleId: 'r1', department: 'ops' };

function perms(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    roleId: 'r1',
    roleName: 'Dispatcher',
    isSystemRole: false,
    permissions: { messages: { view: true, send: true, manage: true }, team_chat: { view: true, send: true, manage_groups: false } } as never,
    dataScope: { messages: 'all' } as never,
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

function makeService(opts: {
  conversation?: ReturnType<typeof createMockConversation> | null;
  optedOut?: boolean;
  sender?: { from?: string; source: string };
  append?: { duplicate: boolean; existing?: { conversationId: string; messageSk: string } };
  enqueue?: 'queued' | Error;
  deal?: Record<string, unknown> | null;
  renderer?: { render: jest.Mock };
} = {}) {
  const conversation = opts.conversation === undefined ? createMockConversation() : opts.conversation;
  const conversations = {
    get: jest.fn(async () => conversation),
    getByParty: jest.fn(async () => null),
    getByAddress: jest.fn(async () => null),
    findOrCreate: jest.fn(async (input: { conversation: unknown }) => ({ conversation: input.conversation, created: true })),
  };
  const messages = {
    appendOutbound: jest.fn(async (input: { conversation: unknown }) => ({ duplicate: false, conversation: input.conversation, ...(opts.append ?? {}) })),
    getBySk: jest.fn(async () => createMockMessage({ id: 'first', direction: 'outbound', status: 'sent' })),
    updateStatus: jest.fn(async () => true),
  };
  const optOuts = { isOptedOut: jest.fn(async () => opts.optedOut ?? false) };
  const sender = { resolve: jest.fn(async () => opts.sender ?? { from: '+15550001111', source: 'sticky' }) };
  const queue = {
    enqueue: jest.fn(async () => {
      if (opts.enqueue instanceof Error) throw opts.enqueue;
      return opts.enqueue ?? 'queued';
    }),
  };
  const deals = { find: jest.fn(async () => opts.deal ?? null) };
  const crm = { getContact: jest.fn(async () => null), findByPhone: jest.fn(async () => null) };
  const events = { conversationUpdated: jest.fn(async () => undefined) };
  const service = new SendService(
    conversations as any,
    messages as any,
    optOuts as any,
    sender as any,
    queue as any,
    deals as any,
    crm as any,
    events as any,
    opts.renderer as any,
  );
  return { service, conversations, messages, optOuts, sender, queue, deals, crm, events };
}

const dto = (overrides: Partial<SendMessageDto> = {}): SendMessageDto => ({
  clientMessageId: CM,
  channel: 'sms',
  body: '  On my way  ',
  ...overrides,
});

describe('SendService.sendToConversation', () => {
  it('stores a queued outbound message under the idempotency key and enqueues it', async () => {
    const { service, messages, queue, sender, events, optOuts } = makeService();
    const m = await service.sendToConversation('c1', dto({ dealId: CM, templateId: CM }), { user, perms: perms() });

    expect(m).toMatchObject({
      conversationId: 'c1',
      channel: 'sms',
      direction: 'outbound',
      body: 'On my way',
      from: '+15550001111',
      to: '+14045551234',
      businessNumber: '+15550001111',
      senderSource: 'sticky',
      status: 'queued',
      provider: 'twilio',
      origin: 'user',
      sentByUserId: 'u1',
      dealId: CM,
      templateId: CM,
    });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.createdAt).toBe(m.updatedAt);
    expect(optOuts.isOptedOut).toHaveBeenCalledWith('sms', '+14045551234');
    expect(sender.resolve).toHaveBeenCalledWith({ requested: undefined, conversation: expect.objectContaining({ id: 'c1' }), dealId: CM });
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ message: m, clientMessageId: CM, createdBy: 'u1', at: m.createdAt }));
    expect(queue.enqueue).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: m.createdAt, messageId: m.id });
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('404s on an unknown conversation', async () => {
    const { service } = makeService({ conversation: null });
    await expect(service.sendToConversation('nope', dto(), { user, perms: perms() })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an opted-out recipient with 422 RECIPIENT_OPTED_OUT before touching the sender or the table', async () => {
    const { service, messages, sender } = makeService({ optedOut: true });
    const err = await service.sendToConversation('c1', dto(), { user, perms: perms() }).catch((e) => e);
    expect(err).toBeInstanceOf(RecipientOptedOutException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toMatch(/^RECIPIENT_OPTED_OUT/);
    expect(sender.resolve).not.toHaveBeenCalled();
    expect(messages.appendOutbound).not.toHaveBeenCalled();
  });

  it('returns the first message on a repeated clientMessageId instead of sending again', async () => {
    const { service, messages, queue } = makeService({ append: { duplicate: true, existing: { conversationId: 'c1', messageSk: `MSG#${T1}#first` } } });
    const m = await service.sendToConversation('c1', dto(), { user, perms: perms() });
    expect(m.id).toBe('first');
    expect(messages.getBySk).toHaveBeenCalledWith('c1', `MSG#${T1}#first`);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('marks the message failed and answers 502 when the queue is unreachable', async () => {
    const { service, messages } = makeService({ enqueue: new Error('sqs down') });
    await expect(service.sendToConversation('c1', dto(), { user, perms: perms() })).rejects.toMatchObject({ status: 502 });
    expect(messages.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1' }),
      expect.objectContaining({ status: 'failed', errorCode: 'ENQUEUE_FAILED', errorMessage: 'sqs down' }),
    );
  });

  it('honours toAddress only when it is one of the conversation phones', async () => {
    const conversation = createMockConversation({ addresses: { phones: ['+14045551234', '+14045559999'], emails: [] } });
    const { service } = makeService({ conversation });
    const m = await service.sendToConversation('c1', dto({ toAddress: '(404) 555-9999' }), { user, perms: perms() });
    expect(m.to).toBe('+14045559999');
    await expect(service.sendToConversation('c1', dto({ toAddress: '+15550000000' }), { user, perms: perms() })).rejects.toMatchObject({ status: 400 });
  });

  it('400s when the conversation has no phone to text', async () => {
    const { service } = makeService({ conversation: createMockConversation({ addresses: { phones: [], emails: ['a@b.co'] } }) });
    await expect(service.sendToConversation('c1', dto(), { user, perms: perms() })).rejects.toMatchObject({ status: 400 });
  });

  it('answers 501 for email and in-app until those channels exist', async () => {
    const { service } = makeService();
    await expect(service.sendToConversation('c1', dto({ channel: 'email', subject: 's' }), { user, perms: perms() })).rejects.toMatchObject({ status: 501 });
    await expect(service.sendToConversation('c1', dto({ channel: 'in_app' }), { user, perms: perms() })).rejects.toMatchObject({ status: 501 });
  });

  it('needs team_chat.send for team and group conversations', async () => {
    const team = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'u2' });
    const { service } = makeService({ conversation: team });
    const noTeam = perms({ permissions: { messages: { view: true, send: true, manage: true }, team_chat: { view: true, send: false } } as never });
    await expect(service.sendToConversation('c1', dto(), { user, perms: noTeam })).rejects.toMatchObject({ status: 403 });
    await expect(service.sendToConversation('c1', dto(), { user, perms: perms() })).resolves.toMatchObject({ status: 'queued' });
    const superAdmin = perms({ isSystemRole: true, roleName: 'Super Admin', permissions: {} as never });
    await expect(service.sendToConversation('c1', dto(), { user, perms: superAdmin })).resolves.toMatchObject({ status: 'queued' });
  });

  it('under assigned_only scope, only lets a user text clients of jobs they are on', async () => {
    const scoped = perms({ dataScope: { messages: 'assigned_only' } as never });
    const conversation = createMockConversation({ lastDealId: 'd1' });

    const onJob = makeService({ conversation, deal: { id: 'd1', assignedTechIds: ['u1'] } });
    await expect(onJob.service.sendToConversation('c1', dto(), { user, perms: scoped })).resolves.toMatchObject({ status: 'queued' });
    expect(onJob.deals.find).toHaveBeenCalledWith('d1');

    const offJob = makeService({ conversation, deal: { id: 'd1', assignedTechIds: ['u9'] } });
    await expect(offJob.service.sendToConversation('c1', dto(), { user, perms: scoped })).rejects.toMatchObject({ status: 403 });

    const unreadable = makeService({ conversation, deal: null });
    await expect(unreadable.service.sendToConversation('c1', dto(), { user, perms: scoped })).rejects.toMatchObject({ status: 403 });

    const noJob = makeService({ conversation: createMockConversation() });
    await expect(noJob.service.sendToConversation('c1', dto(), { user, perms: scoped })).rejects.toMatchObject({ status: 403 });
    expect(noJob.deals.find).not.toHaveBeenCalled();
  });

  it('records attachments as stored uploads under the caller’s own prefix and caps the total at 5 MB', async () => {
    const { service } = makeService();
    const a = { id: CM, fileName: 'door.jpg', contentType: 'image/jpeg' as const, size: 3 * 1024 * 1024 };
    const m = await service.sendToConversation('c1', dto({ attachments: [a] }), { user, perms: perms() });
    expect(m.attachments).toEqual([{ id: CM, fileName: 'door.jpg', contentType: 'image/jpeg', size: a.size, status: 'stored', s3Key: uploadKey('u1', CM) }]);
    expect(m.attachments![0].s3Key).toBe(`messaging/uploads/u1/${CM}`);

    await expect(
      service.sendToConversation('c1', dto({ attachments: [a, { ...a, id: '7f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f' }] }), { user, perms: perms() }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('renders through the templates module when one is wired, keeping the composer text otherwise', async () => {
    const renderer = { render: jest.fn(async (): Promise<{ body: string } | null> => ({ body: 'Hi Jane, on my way' })) };
    const { service } = makeService({ renderer });
    const m = await service.sendToConversation('c1', dto({ templateId: CM }), { user, perms: perms() });
    expect(m.body).toBe('Hi Jane, on my way');
    expect(renderer.render).toHaveBeenCalledWith(expect.objectContaining({ templateId: CM, channel: 'sms', conversationId: 'c1', partyKind: 'contact', partyId: 'ct1', body: 'On my way' }));

    renderer.render.mockResolvedValueOnce(null);
    expect((await service.sendToConversation('c1', dto({ templateId: CM }), { user, perms: perms() })).body).toBe('On my way');
  });
});

describe('SendService.sendToParty', () => {
  const start = (overrides: Partial<StartConversationMessageDto>): StartConversationMessageDto => ({ ...dto(), ...overrides });

  it('reuses the contact’s conversation when it exists', async () => {
    const { service, conversations, crm } = makeService();
    conversations.getByParty.mockResolvedValueOnce(createMockConversation({ id: 'c9' }) as never);
    const m = await service.sendToParty(start({ contactId: CM }), { user, perms: perms() });
    expect(m.conversationId).toBe('c9');
    expect(conversations.getByParty).toHaveBeenCalledWith('contact', CM);
    expect(crm.getContact).not.toHaveBeenCalled();
  });

  it('opens a client conversation from CRM addresses for a contact without one', async () => {
    const { service, conversations, crm } = makeService();
    crm.getContact.mockResolvedValueOnce({ id: CM, phones: ['(404) 555-1234'], emails: ['j@x.co'] } as never);
    const m = await service.sendToParty(start({ contactId: CM }), { user, perms: perms() });

    const input = conversations.findOrCreate.mock.calls[0][0] as any;
    expect(input.pointer).toEqual({ kind: 'contact', id: CM });
    expect(input.conversation).toMatchObject({ kind: 'client', partyKind: 'contact', partyId: CM, state: 'open', unread: false, addresses: { phones: ['+14045551234'], emails: ['j@x.co'] } });
    expect(input.addresses).toEqual([{ address: '+14045551234', source: 'crm' }]);
    expect(m.to).toBe('+14045551234');
    expect(m.conversationId).toBe(input.conversation.id);
  });

  it('404s on an unknown contact and 400s on a phone the contact does not have', async () => {
    const missing = makeService();
    await expect(missing.service.sendToParty(start({ contactId: CM }), { user, perms: perms() })).rejects.toMatchObject({ status: 404 });

    const other = makeService();
    other.crm.getContact.mockResolvedValueOnce({ id: CM, phones: ['+14045551234'], emails: [] } as never);
    await expect(other.service.sendToParty(start({ contactId: CM, phone: '+14045550000' }), { user, perms: perms() })).rejects.toMatchObject({ status: 400 });
  });

  it('routes a bare number through ADDR#, then CRM, then an unknown conversation', async () => {
    const routed = makeService();
    routed.conversations.getByAddress.mockResolvedValueOnce({ conversationId: 'c1' } as never);
    expect((await routed.service.sendToParty(start({ phone: '+14045551234' }), { user, perms: perms() })).conversationId).toBe('c1');
    expect(routed.crm.findByPhone).not.toHaveBeenCalled();

    const owned = makeService();
    owned.crm.findByPhone.mockResolvedValueOnce({ kind: 'contact', id: 'ct7' } as never);
    owned.crm.getContact.mockResolvedValueOnce({ id: 'ct7', phones: ['+14045551234', '+14045557777'], emails: [] } as never);
    await owned.service.sendToParty(start({ phone: '+14045551234' }), { user, perms: perms() });
    const created = owned.conversations.findOrCreate.mock.calls[0][0] as any;
    expect(created.pointer).toEqual({ kind: 'contact', id: 'ct7' });
    expect(created.conversation.addresses.phones).toEqual(['+14045551234', '+14045557777']);

    const unknown = makeService();
    const m = await unknown.service.sendToParty(start({ phone: '+14045551234' }), { user, perms: perms() });
    const u = unknown.conversations.findOrCreate.mock.calls[0][0] as any;
    expect(u.pointer).toEqual({ kind: 'address', id: '+14045551234' });
    expect(u.conversation).toMatchObject({ kind: 'unknown', partyKind: 'none', addresses: { phones: ['+14045551234'], emails: [] } });
    expect(u.addresses).toEqual([{ address: '+14045551234', source: 'manual' }]);
    expect(m.to).toBe('+14045551234');
  });

  it('conversationForParty (POST /conversations) says whether it opened the thread', async () => {
    const found = makeService();
    found.conversations.getByParty.mockResolvedValueOnce(createMockConversation({ id: 'c9' }) as never);
    expect(await found.service.conversationForParty({ contactId: CM })).toEqual({ conversation: expect.objectContaining({ id: 'c9' }), created: false });

    const opened = makeService();
    opened.crm.getContact.mockResolvedValueOnce({ id: CM, phones: ['+14045551234'], emails: [] } as never);
    expect((await opened.service.conversationForParty({ contactId: CM })).created).toBe(true);

    await expect(makeService().service.conversationForParty({})).rejects.toMatchObject({ status: 400 });
  });
});
