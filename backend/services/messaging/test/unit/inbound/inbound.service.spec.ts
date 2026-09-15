import { ForbiddenException } from '@nestjs/common';
import { type Conversation } from '@bitcrm/types';
import { InboundService } from '../../../src/inbound/inbound.service';
import { PartyResolver } from '../../../src/inbound/party-resolver';
import { type PhoneDirectory } from '../../../src/inbound/phone-directory';
import { type InboundMessageInput } from '../../../src/inbound/twilio-inbound.payload';
import {
  type ConversationsRepository,
  type FindOrCreateInput,
} from '../../../src/conversations/conversations.repository';
import { type AppendInboundInput, type MessagesRepository } from '../../../src/messages/messages.repository';
import { type OptOutsRepository } from '../../../src/opt-outs/opt-outs.repository';
import { type MediaQueueService } from '../../../src/media/media-queue.service';
import { createMockConversation, T0 } from '../mocks';

const ACCOUNT = 'AC00000000000000000000000000000000';
const FROM = '+14045551234';
const TO = '+15550001111';
const AT = '2026-09-15T10:05:00.000Z';
const MEDIA_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/MM1/Media/ME0123456789abcdef0123456789abcdef`;

const input = (over: Partial<InboundMessageInput> = {}): InboundMessageInput => ({
  providerSid: 'SM1',
  accountSid: ACCOUNT,
  messagingServiceSid: 'MG1',
  from: FROM,
  to: TO,
  body: 'Hello',
  segments: 1,
  media: [],
  ...over,
});

interface Fixture {
  pointer?: Record<string, unknown> | null;
  /** What `conversations.get` answers for the pointed conversation. */
  pointed?: Conversation | null;
  user?: unknown;
  contact?: unknown;
  /** What `findOrCreate` answers. */
  findOrCreate?: { conversation: Conversation; created: boolean };
  seen?: boolean;
  appendDuplicate?: boolean;
  optOutError?: Error;
  queueEnabled?: boolean;
  queueError?: Error;
  accountSid?: string;
}

function make(f: Fixture = {}) {
  const conversations = {
    getByAddress: jest.fn().mockResolvedValue(f.pointer ?? null),
    get: jest.fn().mockResolvedValue(f.pointed ?? null),
    findOrCreate: jest.fn(async (args: FindOrCreateInput) =>
      f.findOrCreate ?? { conversation: args.conversation, created: true },
    ),
    putAddressPointer: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(async (current: Conversation, patch: Record<string, unknown>) => ({
      ...current,
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? undefined])),
      updatedAt: AT,
    })),
  };
  const messages = {
    getProviderSidPointer: jest.fn().mockResolvedValue(f.seen ? { providerSid: 'SM1', conversationId: 'c-seen' } : null),
    appendInbound: jest.fn(async (args: AppendInboundInput) => ({
      duplicate: Boolean(f.appendDuplicate),
      conversation: args.conversation,
    })),
  };
  const optOuts = {
    setStatus: f.optOutError ? jest.fn().mockRejectedValue(f.optOutError) : jest.fn().mockResolvedValue({}),
  };
  const directory = {
    lookupUser: jest.fn().mockResolvedValue(f.user ?? null),
    lookupContact: jest.fn().mockResolvedValue(f.contact ?? null),
  };
  const mediaQueue = {
    enabled: f.queueEnabled ?? true,
    enqueueMediaCopy: f.queueError
      ? jest.fn().mockRejectedValue(f.queueError)
      : jest.fn().mockResolvedValue(f.queueEnabled ?? true),
  };
  const sns = { publish: jest.fn().mockResolvedValue(undefined) };
  const parties = new PartyResolver(
    conversations as unknown as ConversationsRepository,
    directory as unknown as PhoneDirectory,
  );
  const service = new InboundService(
    { accountSid: f.accountSid ?? ACCOUNT },
    conversations as unknown as ConversationsRepository,
    messages as unknown as MessagesRepository,
    optOuts as unknown as OptOutsRepository,
    parties,
    mediaQueue as unknown as MediaQueueService,
    sns as never,
  );
  return { service, conversations, messages, optOuts, directory, mediaQueue, sns };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('InboundService.ingest — guards', () => {
  it('rejects a message from another Twilio account with 403 before touching storage', async () => {
    const { service, messages } = make();
    await expect(service.ingest(input({ accountSid: 'ACother' }), { source: 'webhook' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(messages.getProviderSidPointer).not.toHaveBeenCalled();
  });

  it('answers duplicate from PSID# without resolving anything', async () => {
    const { service, conversations, messages } = make({ seen: true });
    const res = await service.ingest(input(), { source: 'webhook' });
    expect(res).toEqual({ outcome: 'duplicate', conversationId: 'c-seen', conversationCreated: false, mediaQueued: 0 });
    expect(conversations.getByAddress).not.toHaveBeenCalled();
    expect(messages.appendInbound).not.toHaveBeenCalled();
  });

  it('answers duplicate when the transaction guard trips (a race with a retry)', async () => {
    const { service, sns, mediaQueue } = make({ appendDuplicate: true, contact: { kind: 'contact', id: 'ct1' } });
    const res = await service.ingest(input({ media: [{ index: 0, url: MEDIA_URL, contentType: 'image/jpeg' }] }), {
      source: 'webhook',
    });
    expect(res.outcome).toBe('duplicate');
    expect(mediaQueue.enqueueMediaCopy).not.toHaveBeenCalled();
    expect(sns.publish).not.toHaveBeenCalled();
  });
});

describe('InboundService.ingest — routing', () => {
  it('ADDR# hit: appends to the pointed conversation, no directory call, no pointer write', async () => {
    const existing = createMockConversation({ id: 'c1', unread: true, unreadCount: 2 });
    const { service, conversations, messages, directory } = make({
      pointer: { address: FROM, conversationId: 'c1', partyKind: 'contact', partyId: 'ct1' },
      pointed: existing,
    });
    const res = await service.ingest(input(), { source: 'webhook', at: AT });

    expect(res).toMatchObject({ outcome: 'stored', conversationId: 'c1', conversationCreated: false, mediaQueued: 0 });
    expect(directory.lookupUser).not.toHaveBeenCalled();
    expect(conversations.findOrCreate).not.toHaveBeenCalled();
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();

    const { message, conversation, at } = messages.appendInbound.mock.calls[0][0];
    expect(conversation).toBe(existing);
    expect(at).toBe(AT);
    expect(message).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      conversationId: 'c1',
      channel: 'sms',
      direction: 'inbound',
      body: 'Hello',
      from: FROM,
      to: TO,
      businessNumber: TO,
      contactAddress: FROM,
      status: 'received',
      segments: 1,
      provider: 'twilio',
      providerSid: 'SM1',
      origin: 'contact',
      createdAt: AT,
      updatedAt: AT,
    });
    expect(message.attachments).toBeUndefined();
    expect(res.messageId).toBe(message.id);
  });

  it('a teammate texting from their personal phone opens a team conversation', async () => {
    const { service, conversations, messages } = make({ user: { id: 'u1', name: 'Ann' } });
    const res = await service.ingest(input(), { source: 'webhook', at: AT });

    expect(res.conversationCreated).toBe(true);
    const args = conversations.findOrCreate.mock.calls[0][0];
    expect(args.pointer).toEqual({ kind: 'user', id: 'u1' });
    expect(args.addresses).toEqual([{ address: FROM, source: 'crm' }]);
    expect(args.conversation).toMatchObject({
      kind: 'team',
      partyKind: 'user',
      partyId: 'u1',
      addresses: { phones: [FROM], emails: [] },
      state: 'open',
      unread: false,
      unreadCount: 0,
      flagged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    expect(args.conversation.needsResolution).toBeUndefined();
    expect(messages.appendInbound.mock.calls[0][0].message.origin).toBe('employee');
  });

  it('a CRM contact opens a client conversation keyed CONVOF#contact#<id>', async () => {
    const { service, conversations } = make({ contact: { kind: 'contact', id: 'ct1', name: 'Bob' } });
    await service.ingest(input(), { source: 'webhook', at: AT });
    const args = conversations.findOrCreate.mock.calls[0][0];
    expect(args.pointer).toEqual({ kind: 'contact', id: 'ct1' });
    expect(args.conversation).toMatchObject({ kind: 'client', partyKind: 'contact', partyId: 'ct1' });
  });

  it("a company's main line opens a client conversation keyed CONVOF#company#<id>", async () => {
    const { service, conversations } = make({ contact: { kind: 'company', id: 'co1' } });
    await service.ingest(input(), { source: 'webhook', at: AT });
    expect(conversations.findOrCreate.mock.calls[0][0].pointer).toEqual({ kind: 'company', id: 'co1' });
    expect(conversations.findOrCreate.mock.calls[0][0].conversation).toMatchObject({ kind: 'client', partyKind: 'company' });
  });

  it('a known party reached from a new phone: adopts the address and (re)points ADDR#', async () => {
    const existing = createMockConversation({ id: 'c1', addresses: { phones: ['+14045550000'], emails: [] } });
    const { service, conversations, messages } = make({
      contact: { kind: 'contact', id: 'ct1' },
      findOrCreate: { conversation: existing, created: false },
    });
    const res = await service.ingest(input(), { source: 'webhook', at: AT });

    expect(res.conversationCreated).toBe(false);
    expect(conversations.putAddressPointer).toHaveBeenCalledWith({
      address: FROM,
      conversationId: 'c1',
      partyKind: 'contact',
      partyId: 'ct1',
      source: 'crm',
      updatedAt: AT,
    });
    expect(conversations.update).toHaveBeenCalledWith(
      existing,
      { addresses: { phones: ['+14045550000', FROM], emails: [] } },
      { at: AT },
    );
    // the append is built on the conversation as updated, not the stale read
    expect(messages.appendInbound.mock.calls[0][0].conversation.addresses.phones).toContain(FROM);
  });

  it('a known party on a known phone whose ADDR# was lost: re-points without an update', async () => {
    const existing = createMockConversation({ id: 'c1', addresses: { phones: [FROM], emails: [] } });
    const { service, conversations } = make({
      contact: { kind: 'contact', id: 'ct1' },
      findOrCreate: { conversation: existing, created: false },
    });
    await service.ingest(input(), { source: 'webhook', at: AT });
    expect(conversations.putAddressPointer).toHaveBeenCalledTimes(1);
    expect(conversations.update).not.toHaveBeenCalled();
  });

  it('nobody in CRM or the team: an unknown conversation keyed CONVOF#address#<From>, no ADDR# row', async () => {
    const { service, conversations, messages } = make();
    const res = await service.ingest(input(), { source: 'webhook', at: AT });

    expect(res.conversationCreated).toBe(true);
    const args = conversations.findOrCreate.mock.calls[0][0];
    expect(args.pointer).toEqual({ kind: 'address', id: FROM });
    expect(args.addresses).toBeUndefined();
    expect(args.conversation).toMatchObject({ kind: 'unknown', partyKind: 'none', addresses: { phones: [FROM], emails: [] } });
    expect(args.conversation.partyId).toBeUndefined();
    expect(args.conversation.needsResolution).toBeUndefined();
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();
    expect(messages.appendInbound.mock.calls[0][0].message.origin).toBe('contact');
  });

  it('directories unreachable: still stores, as unknown with needsResolution=true', async () => {
    const { service, conversations } = make({ user: 'unreachable', contact: 'unreachable' });
    const res = await service.ingest(input(), { source: 'webhook', at: AT });
    expect(res.outcome).toBe('stored');
    expect(conversations.findOrCreate.mock.calls[0][0].conversation).toMatchObject({ kind: 'unknown', needsResolution: true });
  });

  it('keeps needsResolution honest on an existing unknown conversation', async () => {
    const stale = createMockConversation({ id: 'cu', kind: 'unknown', partyKind: 'none', partyId: undefined, needsResolution: true });
    const { service, conversations } = make({ findOrCreate: { conversation: stale, created: false } });
    await service.ingest(input(), { source: 'webhook', at: AT });
    expect(conversations.update).toHaveBeenCalledWith(stale, { needsResolution: null }, { at: AT });

    const fine = createMockConversation({ id: 'cu', kind: 'unknown', partyKind: 'none', partyId: undefined });
    const degraded = make({ user: 'unreachable', findOrCreate: { conversation: fine, created: false } });
    await degraded.service.ingest(input(), { source: 'webhook', at: AT });
    expect(degraded.conversations.update).toHaveBeenCalledWith(fine, { needsResolution: true }, { at: AT });
  });

  it('a dangling ADDR# (conversation gone) falls back to a fresh resolution', async () => {
    const { service, conversations, directory } = make({
      pointer: { address: FROM, conversationId: 'c-gone', partyKind: 'none' },
      pointed: null,
      contact: { kind: 'contact', id: 'ct1' },
    });
    await service.ingest(input(), { source: 'webhook', at: AT });
    expect(conversations.get).toHaveBeenCalledWith('c-gone');
    expect(directory.lookupContact).toHaveBeenCalled();
    expect(conversations.findOrCreate.mock.calls[0][0].pointer).toEqual({ kind: 'contact', id: 'ct1' });
  });
});

describe('InboundService.ingest — after the write', () => {
  it('STOP records an opt-out with the keyword and the Messaging Service, and announces it', async () => {
    const { service, optOuts, sns } = make();
    const res = await service.ingest(input({ body: 'stop', optOutType: 'STOP' }), { source: 'webhook', at: AT });
    await flush();

    expect(res.optOut).toBe('opted_out');
    expect(optOuts.setStatus).toHaveBeenCalledWith({
      channel: 'sms',
      address: FROM,
      status: 'opted_out',
      source: 'advanced_opt_out',
      keyword: 'STOP',
      messagingServiceSid: 'MG1',
      at: AT,
    });
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'opt_out.changed', {
      channel: 'sms',
      address: FROM,
      status: 'opted_out',
      source: 'advanced_opt_out',
    });
  });

  it('START opts back in; HELP and plain text change nothing', async () => {
    const start = make();
    expect((await start.service.ingest(input({ body: 'START', optOutType: 'START' }), { source: 'webhook' })).optOut).toBe('opted_in');
    expect(start.optOuts.setStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'opted_in', keyword: 'START' }));

    const help = make();
    expect((await help.service.ingest(input({ body: 'HELP', optOutType: 'HELP' }), { source: 'webhook' })).optOut).toBeUndefined();
    expect(help.optOuts.setStatus).not.toHaveBeenCalled();

    const plain = make();
    await plain.service.ingest(input({ body: 'STOP' }), { source: 'webhook' });
    expect(plain.optOuts.setStatus).not.toHaveBeenCalled();
  });

  it('a failing opt-out write is logged, the message stays stored', async () => {
    const { service } = make({ optOutError: new Error('dynamo hiccup') });
    const res = await service.ingest(input({ optOutType: 'STOP' }), { source: 'webhook' });
    expect(res.outcome).toBe('stored');
    expect(res.optOut).toBeUndefined();
  });

  it('MMS: attachments are stored pending and one copy job is queued', async () => {
    const { service, messages, mediaQueue } = make();
    const media = [
      { index: 0, url: MEDIA_URL, contentType: 'image/jpeg', providerMediaSid: 'ME0123456789abcdef0123456789abcdef' },
      { index: 1, url: 'https://example.test/v', contentType: 'video/mp4' },
    ];
    const res = await service.ingest(input({ providerSid: 'MM1', body: undefined, media }), { source: 'webhook', at: AT });

    expect(res.mediaQueued).toBe(2);
    const { message } = messages.appendInbound.mock.calls[0][0];
    expect(message.body).toBeUndefined();
    expect(message.attachments).toEqual([
      {
        id: expect.any(String),
        fileName: 'ME0123456789abcdef0123456789abcdef.jpg',
        contentType: 'image/jpeg',
        status: 'pending',
        sourceUrl: MEDIA_URL,
        providerMediaSid: 'ME0123456789abcdef0123456789abcdef',
      },
      { id: expect.any(String), fileName: 'media-1.mp4', contentType: 'video/mp4', status: 'pending', sourceUrl: 'https://example.test/v', providerMediaSid: undefined },
    ]);
    const [first, second] = message.attachments ?? [];
    expect(mediaQueue.enqueueMediaCopy).toHaveBeenCalledWith({
      conversationId: message.conversationId,
      messageId: message.id,
      createdAt: AT,
      providerSid: 'MM1',
      attachments: [
        { id: first.id, sourceUrl: MEDIA_URL, contentType: 'image/jpeg', providerMediaSid: 'ME0123456789abcdef0123456789abcdef' },
        { id: second.id, sourceUrl: 'https://example.test/v', contentType: 'video/mp4', providerMediaSid: undefined },
      ],
    });
  });

  it('no queue configured or a queue failure: the message is still stored, nothing queued', async () => {
    const off = make({ queueEnabled: false });
    const media = [{ index: 0, url: MEDIA_URL, contentType: 'image/jpeg' }];
    expect((await off.service.ingest(input({ media }), { source: 'webhook' })).mediaQueued).toBe(0);

    const broken = make({ queueError: new Error('SQS down') });
    const res = await broken.service.ingest(input({ media }), { source: 'webhook' });
    expect(res).toMatchObject({ outcome: 'stored', mediaQueued: 0 });
  });

  it('publishes message.received and conversation.updated, fire-and-forget', async () => {
    const { service, sns } = make({ contact: { kind: 'contact', id: 'ct1' } });
    sns.publish.mockRejectedValueOnce(new Error('SNS down'));
    const res = await service.ingest(input(), { source: 'webhook', at: AT });
    await flush();

    expect(res.outcome).toBe('stored');
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'message.received', {
      messageId: res.messageId,
      conversationId: res.conversationId,
      channel: 'sms',
      from: FROM,
      to: TO,
      partyKind: 'contact',
      partyId: 'ct1',
      dealId: undefined,
      providerSid: 'SM1',
      createdAt: AT,
    });
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'conversation.updated', { conversationId: res.conversationId });
  });

  it('reconciliation keeps the provider timestamp as createdAt', async () => {
    const { service, messages } = make();
    await service.ingest(input({ receivedAt: T0 }), { source: 'reconcile', at: AT });
    const { message } = messages.appendInbound.mock.calls[0][0];
    expect(message.createdAt).toBe(T0);
    expect(message.updatedAt).toBe(AT);
  });
});
