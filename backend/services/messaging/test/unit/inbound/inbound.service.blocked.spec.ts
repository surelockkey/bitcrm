import { InboundService } from '../../../src/inbound/inbound.service';
import { PartyResolver } from '../../../src/inbound/party-resolver';
import { type PhoneDirectory } from '../../../src/inbound/phone-directory';
import { type InboundMessageInput } from '../../../src/inbound/twilio-inbound.payload';
import { type ConversationsRepository } from '../../../src/conversations/conversations.repository';
import { type MessagesRepository } from '../../../src/messages/messages.repository';
import { type OptOutsRepository } from '../../../src/opt-outs/opt-outs.repository';
import { type MediaQueueService } from '../../../src/media/media-queue.service';
import { type BlockedNumbersClient } from '../../../src/inbound/blocked-numbers.client';

const ACCOUNT = 'AC00000000000000000000000000000000';

const input = (over: Partial<InboundMessageInput> = {}): InboundMessageInput => ({
  providerSid: 'SM1',
  accountSid: ACCOUNT,
  messagingServiceSid: 'MG1',
  from: '+12147917112',
  to: '+15550001111',
  body: 'Hello',
  segments: 1,
  media: [],
  ...over,
});

/**
 * A text from a number on the block list (Workiz Phone → Blocked callers) is
 * dropped before anything is written: no conversation, no message, no
 * pointer, no event — and Twilio still gets its 200, so it never retries.
 */
function make(blocked: boolean | 'none') {
  const conversations = {
    getByAddress: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
    findOrCreate: jest.fn(async (args: { conversation: unknown }) => ({ conversation: args.conversation, created: true })),
    putAddressPointer: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(),
  };
  const messages = {
    getProviderSidPointer: jest.fn().mockResolvedValue(null),
    appendInbound: jest.fn(async (args: { conversation: unknown }) => ({ duplicate: false, conversation: args.conversation })),
  };
  const optOuts = { setStatus: jest.fn().mockResolvedValue({}) };
  const directory = {
    lookupUser: jest.fn().mockResolvedValue(null),
    lookupContact: jest.fn().mockResolvedValue({ kind: 'contact', id: 'ct1', name: 'Spam' }),
  };
  const mediaQueue = { enabled: true, enqueueMediaCopy: jest.fn().mockResolvedValue(true) };
  const sns = { publish: jest.fn().mockResolvedValue(undefined) };
  const blockedNumbers = blocked === 'none' ? undefined : { isBlocked: jest.fn().mockResolvedValue(blocked) };
  const parties = new PartyResolver(
    conversations as unknown as ConversationsRepository,
    directory as unknown as PhoneDirectory,
  );
  const service = new InboundService(
    { accountSid: ACCOUNT },
    conversations as unknown as ConversationsRepository,
    messages as unknown as MessagesRepository,
    optOuts as unknown as OptOutsRepository,
    parties,
    mediaQueue as unknown as MediaQueueService,
    sns as never,
    undefined,
    undefined,
    blockedNumbers as unknown as BlockedNumbersClient,
  );
  return { service, conversations, messages, sns, blockedNumbers };
}

describe('InboundService.ingest — a blocked sender', () => {
  it('drops the text before any read or write', async () => {
    const { service, conversations, messages, sns, blockedNumbers } = make(true);

    const res = await service.ingest(input(), { source: 'webhook' });

    expect(res).toEqual({ outcome: 'blocked', conversationCreated: false, mediaQueued: 0 });
    expect(blockedNumbers!.isBlocked).toHaveBeenCalledWith('+12147917112');
    expect(messages.getProviderSidPointer).not.toHaveBeenCalled();
    expect(conversations.findOrCreate).not.toHaveBeenCalled();
    expect(messages.appendInbound).not.toHaveBeenCalled();
    expect(sns.publish).not.toHaveBeenCalled();
  });

  it('stores a text from anyone else as before', async () => {
    const { service, messages } = make(false);
    const res = await service.ingest(input(), { source: 'webhook' });
    expect(res.outcome).toBe('stored');
    expect(messages.appendInbound).toHaveBeenCalled();
  });

  it('works without a block list at all', async () => {
    const { service, messages } = make('none');
    const res = await service.ingest(input(), { source: 'webhook' });
    expect(res.outcome).toBe('stored');
    expect(messages.appendInbound).toHaveBeenCalled();
  });
});
