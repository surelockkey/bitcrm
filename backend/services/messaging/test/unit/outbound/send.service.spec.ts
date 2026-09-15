import { type Conversation, type ResolvedPermissions } from '@bitcrm/types';
import {
  EmployeeHasNoPhoneException,
  RecipientOptedOutException,
  SendService,
  teamRecipients,
  uploadKey,
} from '../../../src/outbound/send.service';
import { type SendMessageDto, type StartConversationMessageDto } from '../../../src/outbound/dto/send-message.dto';
import { StaleConversationError } from '../../../src/conversations/conversations.repository';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

const CM = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';
const user = { id: 'u1', cognitoSub: 's', email: 'u1@x.co', roleId: 'r1', department: 'ops' };

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

function makeService(opts: {
  conversation?: ReturnType<typeof createMockConversation> | null;
  optedOut?: boolean;
  sender?: { from?: string; source: string };
  append?: { duplicate: boolean; existing?: { conversationId: string; messageSk: string } };
  enqueue?: 'queued' | Error;
  deal?: Record<string, unknown> | null;
  renderer?: { render: jest.Mock };
  /** `null` = no such user; `'none'` = no directory wired at all. */
  teammate?: { id: string; name: string; phone?: string } | null | 'none';
} = {}) {
  const conversation = opts.conversation === undefined ? createMockConversation() : opts.conversation;
  const conversations = {
    get: jest.fn(async () => conversation),
    getByParty: jest.fn(async () => null),
    getByAddress: jest.fn(async () => null),
    findOrCreate: jest.fn(async (input: { conversation: unknown }) => ({ conversation: input.conversation, created: true })),
    update: jest.fn(async (c: Conversation, patch: Partial<Conversation>) => ({ ...c, ...patch, updatedAt: T1 })),
    putAddressPointer: jest.fn(async () => undefined),
    putReadMarker: jest.fn(async () => undefined),
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
  const realtime = { messageUpserted: jest.fn(), conversationUpserted: jest.fn(), countersChanged: jest.fn() };
  const teammate = opts.teammate === undefined ? { id: 'u2', name: 'Ann Tech', phone: '+14045550002' } : opts.teammate;
  const users = teammate === 'none' ? undefined : { find: jest.fn(async (id: string) => (teammate ? { ...teammate, id } : null)) };
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
    realtime as any,
    users as any,
  );
  return { service, conversations, messages, optOuts, sender, queue, deals, crm, events, realtime, users };
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

  it('a technician under the assigned_only team scope writes only in their own thread and groups', async () => {
    const tech = perms({ dataScope: { messages: 'assigned_only', team_chat: 'assigned_only' } as never });
    const mine = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'u1', addresses: { phones: [], emails: [] } });
    const other = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'u2', addresses: { phones: [], emails: [] } });
    const group = createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', memberIds: ['u1', 'u9'], addresses: { phones: [], emails: [] } });

    await expect(makeService({ conversation: mine }).service.sendToConversation('c1', dto({ channel: 'in_app' }), { user, perms: tech })).resolves.toMatchObject({ channel: 'in_app' });
    await expect(makeService({ conversation: group }).service.sendToConversation('g1', dto({ channel: 'in_app' }), { user, perms: tech })).resolves.toMatchObject({ channel: 'in_app' });
    await expect(makeService({ conversation: other }).service.sendToConversation('c1', dto({ channel: 'in_app' }), { user, perms: tech })).rejects.toMatchObject({ status: 403 });
    await expect(makeService({ conversation: { ...group, memberIds: ['u9'] } }).service.sendToConversation('g1', dto({ channel: 'in_app' }), { user, perms: tech })).rejects.toMatchObject({ status: 403 });
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

// ---------------------------------------------------------------------------
// M16: in-app delivery and SMS to employees (design §6)
// ---------------------------------------------------------------------------
const TEAM = createMockConversation({
  id: 'c-u2', kind: 'team', partyKind: 'user', partyId: 'u2',
  addresses: { phones: ['+14045550002'], emails: [] }, lastBusinessNumber: '+15550001111',
});
const GROUP = createMockConversation({
  id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', name: 'Night shift', memberIds: ['u1', 'u2', 'u3'],
  addresses: { phones: [], emails: [] },
});

describe('SendService — channel in_app', () => {
  it('the office writes in an employee thread: stored sent/outbound/user, pushed to the employee, no provider, no opt-out check', async () => {
    const { service, messages, queue, optOuts, sender, conversations, realtime, events } = makeService({ conversation: TEAM });
    const m = await service.sendToConversation('c-u2', dto({ channel: 'in_app', body: ' Come to the shop ', dealId: CM }), { user, perms: perms() });

    expect(m).toMatchObject({
      conversationId: 'c-u2', channel: 'in_app', direction: 'outbound', body: 'Come to the shop', status: 'sent',
      origin: 'user', sentByUserId: 'u1', sentByName: 'Ann Tech', dealId: CM,
    });
    expect(m.from).toBeUndefined();
    expect(m.to).toBeUndefined();
    expect(m.provider).toBeUndefined();
    expect(m.sentAt).toBe(m.createdAt);
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ message: m, clientMessageId: CM, createdBy: 'u1', markUnread: false }));
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(optOuts.isOptedOut).not.toHaveBeenCalled();
    expect(sender.resolve).not.toHaveBeenCalled();
    expect(conversations.putReadMarker).toHaveBeenCalledWith('c-u2', 'u1', { lastReadMessageSk: `MSG#${m.createdAt}#${m.id}`, at: m.createdAt });
    expect(realtime.messageUpserted).toHaveBeenCalledWith(m, expect.objectContaining({ id: 'c-u2' }), m.createdAt, { recipients: ['u2'], mentions: undefined });
    expect(events.conversationUpdated).toHaveBeenCalledWith('c-u2');
  });

  it('the employee writes on their own thread: inbound / employee, the office is marked unread, nobody to push to', async () => {
    const mine = { ...TEAM, partyId: 'u1' };
    const { service, messages, realtime } = makeService({ conversation: mine });
    const m = await service.sendToConversation('c-u2', dto({ channel: 'in_app' }), { user, perms: perms() });
    expect(m).toMatchObject({ direction: 'inbound', origin: 'employee', status: 'sent' });
    expect(messages.appendOutbound).toHaveBeenCalledWith(expect.objectContaining({ markUnread: true }));
    expect(realtime.messageUpserted).toHaveBeenCalledWith(m, expect.anything(), m.createdAt, { recipients: [], mentions: undefined });
  });

  it('a group line goes to every other member, with the mentions deduplicated and carried on the message', async () => {
    const { service, realtime } = makeService({ conversation: GROUP });
    const m = await service.sendToConversation('g1', dto({ channel: 'in_app', mentions: ['u3', 'u3'] }), { user, perms: perms() });
    expect(m).toMatchObject({ direction: 'outbound', origin: 'user', mentions: ['u3'] });
    expect(realtime.messageUpserted).toHaveBeenCalledWith(m, expect.objectContaining({ id: 'g1' }), m.createdAt, { recipients: ['u2', 'u3'], mentions: ['u3'] });
    expect(teamRecipients(GROUP, 'u2')).toEqual(['u1', 'u3']);
    expect(teamRecipients(createMockConversation(), 'u1')).toEqual([]);
  });

  it('returns the first message on a repeated clientMessageId, and survives a directory or marker hiccup', async () => {
    const dup = makeService({ conversation: GROUP, append: { duplicate: true, existing: { conversationId: 'g1', messageSk: `MSG#${T1}#first` } } });
    expect((await dup.service.sendToConversation('g1', dto({ channel: 'in_app' }), { user, perms: perms() })).id).toBe('first');
    expect(dup.conversations.putReadMarker).not.toHaveBeenCalled();

    const flaky = makeService({ conversation: GROUP });
    flaky.users!.find.mockRejectedValue(new Error('503'));
    flaky.conversations.putReadMarker.mockRejectedValue(new Error('dynamo'));
    const m = await flaky.service.sendToConversation('g1', dto({ channel: 'in_app' }), { user, perms: perms() });
    expect(m.sentByName).toBeUndefined();
    expect(flaky.realtime.messageUpserted).toHaveBeenCalled();

    const bare = makeService({ conversation: GROUP, teammate: 'none' });
    expect((await bare.service.sendToConversation('g1', dto({ channel: 'in_app' }), { user, perms: perms() })).sentByName).toBeUndefined();
  });

  it('still answers 501 for in-app in a client thread and for email anywhere', async () => {
    const { service } = makeService();
    await expect(service.sendToConversation('c1', dto({ channel: 'in_app' }), { user, perms: perms() })).rejects.toMatchObject({ status: 501 });
    await expect(makeService({ conversation: TEAM }).service.sendToConversation('c-u2', dto({ channel: 'email', subject: 's' }), { user, perms: perms() })).rejects.toMatchObject({ status: 501 });
  });

  it('a blank body is refused before anything is written', async () => {
    const { service, messages } = makeService({ conversation: GROUP });
    await expect(service.sendToConversation('g1', dto({ channel: 'in_app', body: '   ' }), { user, perms: perms() })).rejects.toMatchObject({ status: 400 });
    expect(messages.appendOutbound).not.toHaveBeenCalled();
  });
});

describe('SendService — SMS to an employee', () => {
  it('texts the personal phone user-service has now, from the default/sticky number (no job), origin user', async () => {
    const stale = { ...TEAM, addresses: { phones: ['+14045559999'], emails: [] }, lastDealId: CM };
    const { service, users, sender, conversations, optOuts } = makeService({ conversation: stale, teammate: { id: 'u2', name: 'Ann', phone: '(404) 555-0002' } });
    const m = await service.sendToConversation('c-u2', dto({ dealId: CM }), { user, perms: perms() });

    expect(users!.find).toHaveBeenCalledWith('u2');
    expect(m).toMatchObject({ channel: 'sms', to: '+14045550002', from: '+15550001111', origin: 'user', status: 'queued', dealId: CM });
    expect(optOuts.isOptedOut).toHaveBeenCalledWith('sms', '+14045550002');
    expect(sender.resolve).toHaveBeenCalledWith({ requested: undefined, conversation: expect.objectContaining({ id: 'c-u2' }), dealId: undefined });
    // The number is adopted onto the thread and pointed at it, so the reply routes straight back.
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(expect.objectContaining({ address: '+14045550002', conversationId: 'c-u2', partyKind: 'user', partyId: 'u2', source: 'crm' }));
    expect(conversations.update).toHaveBeenCalledWith(stale, { addresses: { phones: ['+14045550002', '+14045559999'], emails: [] } }, expect.anything());
  });

  it('does not rewrite the thread when the phone is already on it; tolerates a concurrent write', async () => {
    const same = makeService({ conversation: TEAM });
    await same.service.sendToConversation('c-u2', dto(), { user, perms: perms() });
    expect(same.conversations.update).not.toHaveBeenCalled();
    expect(same.conversations.putAddressPointer).not.toHaveBeenCalled();

    const raced = makeService({ conversation: { ...TEAM, addresses: { phones: [], emails: [] } } });
    raced.conversations.update.mockRejectedValueOnce(new StaleConversationError('c-u2'));
    await expect(raced.service.sendToConversation('c-u2', dto(), { user, perms: perms() })).resolves.toMatchObject({ to: '+14045550002' });
    expect(raced.conversations.get).toHaveBeenCalledTimes(2);
  });

  it('refuses with 422 EMPLOYEE_HAS_NO_PHONE, 404 for a vanished user, 400 for a foreign toAddress, and honours opt-out', async () => {
    const noPhone = makeService({ conversation: TEAM, teammate: { id: 'u2', name: 'Ann' } });
    const err = await noPhone.service.sendToConversation('c-u2', dto(), { user, perms: perms() }).catch((e) => e);
    expect(err).toBeInstanceOf(EmployeeHasNoPhoneException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toMatch(/^EMPLOYEE_HAS_NO_PHONE/);
    expect(noPhone.messages.appendOutbound).not.toHaveBeenCalled();

    await expect(makeService({ conversation: TEAM, teammate: null }).service.sendToConversation('c-u2', dto(), { user, perms: perms() })).rejects.toMatchObject({ status: 404 });
    await expect(makeService({ conversation: TEAM }).service.sendToConversation('c-u2', dto({ toAddress: '+14045559999' }), { user, perms: perms() })).rejects.toMatchObject({ status: 400 });
    await expect(makeService({ conversation: TEAM }).service.sendToConversation('c-u2', dto({ toAddress: '(404) 555-0002' }), { user, perms: perms() })).resolves.toMatchObject({ to: '+14045550002' });
    await expect(makeService({ conversation: TEAM, optedOut: true }).service.sendToConversation('c-u2', dto(), { user, perms: perms() })).rejects.toBeInstanceOf(RecipientOptedOutException);
  });

  it('falls back to the thread’s own number when no directory is wired', async () => {
    const { service, sender } = makeService({ conversation: TEAM, teammate: 'none' });
    const m = await service.sendToConversation('c-u2', dto({ dealId: CM }), { user, perms: perms() });
    expect(m.to).toBe('+14045550002');
    expect(sender.resolve).toHaveBeenCalledWith(expect.objectContaining({ dealId: undefined }));
  });
});
