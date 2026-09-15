import { type TwilioRest } from '@bitcrm/shared';
import { type Message } from '@bitcrm/types';
import { DEFAULT_LOOKBACK_MS, ReconcileService, fromTwilioStatus } from '../../../src/reconcile/reconcile.service';
import { type InboundService } from '../../../src/inbound/inbound.service';
import { type AppendOutboundInput, type MessagesRepository } from '../../../src/messages/messages.repository';
import { type MediaQueueService } from '../../../src/media/media-queue.service';
import { T0, T1, createMockConversation, createMockMessage } from '../mocks';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const AT = NOW.toISOString();
const ACCOUNT = 'AC00000000000000000000000000000000';
const CLIENT = '+14045551234';
const OURS = '+15550001111';

/** A Twilio `MessageInstance` as the SDK returns it (only the fields we read). */
function twilioMessage(over: Record<string, unknown> = {}) {
  return {
    sid: 'SM1',
    accountSid: ACCOUNT,
    messagingServiceSid: 'MG1',
    from: CLIENT,
    to: OURS,
    body: 'Hello',
    direction: 'inbound',
    status: 'received',
    numMedia: '0',
    numSegments: '1',
    errorCode: null,
    errorMessage: null,
    dateCreated: new Date('2026-09-15T11:00:00.000Z'),
    dateSent: new Date('2026-09-15T11:00:01.000Z'),
    dateUpdated: new Date('2026-09-15T11:00:05.000Z'),
    ...over,
  };
}

function make(opts: {
  records?: unknown[];
  media?: Array<{ sid: string; contentType: string; uri: string }>;
  known?: string[];
  ingest?: 'stored' | 'duplicate';
  recent?: Message[];
  appendDuplicate?: { conversationId: string; messageSk: string };
  updateApplied?: boolean;
} = {}) {
  const conversation = createMockConversation({ id: 'c1' });
  const client = {
    messages: Object.assign(
      jest.fn(() => ({ media: { list: jest.fn().mockResolvedValue(opts.media ?? []) } })),
      { list: jest.fn().mockResolvedValue(opts.records ?? []) },
    ),
  };
  const twilioRest = { run: jest.fn((fn: (c: unknown) => Promise<unknown>) => fn(client)) };
  const inbound = {
    ingest: jest.fn().mockResolvedValue({ outcome: opts.ingest ?? 'stored', conversationId: 'c1' }),
    locateConversation: jest.fn().mockResolvedValue({ conversation, created: false }),
  };
  const messages = {
    getProviderSidPointer: jest.fn(async (sid: string) => ((opts.known ?? []).includes(sid) ? { providerSid: sid } : null)),
    listByConversation: jest.fn().mockResolvedValue({ items: opts.recent ?? [] }),
    updateStatus: jest.fn().mockResolvedValue(opts.updateApplied ?? true),
    putProviderSidPointer: jest.fn().mockResolvedValue(true),
    appendOutbound: jest.fn(async (_input: AppendOutboundInput) =>
      opts.appendDuplicate
        ? { duplicate: true, conversation, existing: { ...opts.appendDuplicate, clientMessageId: 'x', createdBy: 'reconcile', createdAt: AT, expiresAt: 1 } }
        : { duplicate: false, conversation },
    ),
  };
  const mediaQueue = { enqueueMediaCopy: jest.fn().mockResolvedValue(true) };
  const sns = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new ReconcileService(
    twilioRest as unknown as TwilioRest,
    inbound as unknown as InboundService,
    messages as unknown as MessagesRepository,
    mediaQueue as unknown as MediaQueueService,
    sns as never,
  );
  return { service, client, twilioRest, inbound, messages, mediaQueue, sns, conversation };
}

describe('fromTwilioStatus', () => {
  it('maps Twilio-only statuses onto ours and passes shared ones through', () => {
    expect(fromTwilioStatus('accepted')).toBe('queued');
    expect(fromTwilioStatus('scheduled')).toBe('queued');
    expect(fromTwilioStatus('receiving')).toBe('received');
    expect(fromTwilioStatus('partially_delivered')).toBe('delivered');
    expect(fromTwilioStatus('delivered')).toBe('delivered');
    expect(fromTwilioStatus('undelivered')).toBe('undelivered');
    expect(fromTwilioStatus('canceled')).toBe('canceled');
    expect(fromTwilioStatus('bogus')).toBe('queued');
    expect(fromTwilioStatus(undefined)).toBe('queued');
  });
});

describe('ReconcileService.run — window and listing', () => {
  it('defaults to the last 90 minutes and lists both directions in pages of 1000', async () => {
    const { service, client } = make();
    const report = await service.run({}, NOW);

    expect(report.since).toBe(new Date(NOW.getTime() - DEFAULT_LOOKBACK_MS).toISOString());
    expect(report.until).toBe(AT);
    expect(client.messages.list).toHaveBeenCalledWith({
      dateSentAfter: new Date(report.since),
      dateSentBefore: NOW,
      pageSize: 1000,
    });
    expect(report).toMatchObject({ scanned: 0, skipped: 0, failed: 0, errors: [] });
  });

  it('honours an explicit window and limit, rejects an empty or inverted one', async () => {
    const { service, client } = make();
    await service.run({ since: T0, until: T1, limit: 50 }, NOW);
    expect(client.messages.list).toHaveBeenCalledWith(expect.objectContaining({ dateSentAfter: new Date(T0), dateSentBefore: new Date(T1), limit: 50 }));

    await expect(service.run({ since: T1, until: T0 }, NOW)).rejects.toThrow(/Invalid reconciliation window/);
    await expect(service.run({ since: 'garbage' }, NOW)).rejects.toThrow(/Invalid reconciliation window/);
  });

  it('skips sids already pointed by PSID# and processes the rest oldest first', async () => {
    const { service, inbound } = make({
      records: [
        twilioMessage({ sid: 'SM-new', dateSent: new Date('2026-09-15T11:30:00.000Z') }),
        twilioMessage({ sid: 'SM-known' }),
        twilioMessage({ sid: 'SM-old', dateSent: new Date('2026-09-15T10:30:00.000Z') }),
      ],
      known: ['SM-known'],
    });
    const report = await service.run({}, NOW);

    expect(report).toMatchObject({ scanned: 3, skipped: 1, inbound: { inserted: 2, duplicates: 0 }, failed: 0 });
    expect(inbound.ingest.mock.calls.map((c) => c[0].providerSid)).toEqual(['SM-old', 'SM-new']);
  });

  it('counts a failure per sid and keeps going', async () => {
    const { service } = make({
      records: [twilioMessage({ sid: 'SM-bad', from: 'whatsapp:+1' }), twilioMessage({ sid: 'SM-ok' })],
    });
    const report = await service.run({}, NOW);
    expect(report.failed).toBe(1);
    expect(report.errors).toEqual([{ sid: 'SM-bad', error: expect.stringMatching(/not a phone number pair/) }]);
    expect(report.inbound.inserted).toBe(1);
  });
});

describe('ReconcileService.run — inbound', () => {
  it('feeds an inbound record through the webhook pipeline with Twilio’s timestamp and media', async () => {
    const { service, inbound, client } = make({
      records: [twilioMessage({ sid: 'MM1', body: '  pic ', numMedia: '1', numSegments: '2' })],
      media: [{ sid: 'ME1', contentType: 'image/jpeg', uri: `/2010-04-01/Accounts/${ACCOUNT}/Messages/MM1/Media/ME1.json` }],
    });
    await service.run({}, NOW);

    expect(client.messages).toHaveBeenCalledWith('MM1');
    expect(inbound.ingest).toHaveBeenCalledWith(
      {
        providerSid: 'MM1',
        accountSid: ACCOUNT,
        messagingServiceSid: 'MG1',
        from: CLIENT,
        to: OURS,
        body: 'pic',
        segments: 2,
        media: [
          {
            index: 0,
            url: `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/MM1/Media/ME1`,
            contentType: 'image/jpeg',
            providerMediaSid: 'ME1',
          },
        ],
        receivedAt: '2026-09-15T11:00:01.000Z',
      },
      { source: 'reconcile' },
    );
  });

  it('counts a pipeline duplicate separately from an insert', async () => {
    const { service } = make({ records: [twilioMessage()], ingest: 'duplicate' });
    expect((await service.run({}, NOW)).inbound).toEqual({ inserted: 0, duplicates: 1 });
  });
});

describe('ReconcileService.run — outbound', () => {
  const outbound = (over: Record<string, unknown> = {}) =>
    twilioMessage({
      sid: 'SM-out',
      direction: 'outbound-api',
      from: OURS,
      to: CLIENT,
      body: 'On my way',
      status: 'delivered',
      ...over,
    });

  it('inserts a missing outbound line with Twilio’s status in the recipient’s conversation and points PSID# at it', async () => {
    const { service, inbound, messages, sns, conversation } = make({ records: [outbound()] });
    const report = await service.run({}, NOW);
    await new Promise((r) => setImmediate(r));

    expect(report.outbound).toEqual({ inserted: 1, adopted: 0, duplicates: 0 });
    expect(inbound.locateConversation).toHaveBeenCalledWith(CLIENT, AT);
    const { message, clientMessageId, createdBy, conversation: conv, at } = messages.appendOutbound.mock.calls[0][0];
    expect(conv).toBe(conversation);
    expect(at).toBe(AT);
    expect(clientMessageId).toBe('reconcile:SM-out');
    expect(createdBy).toBe('reconcile');
    expect(message).toMatchObject({
      conversationId: 'c1',
      channel: 'sms',
      direction: 'outbound',
      body: 'On my way',
      from: OURS,
      to: CLIENT,
      businessNumber: OURS,
      contactAddress: CLIENT,
      status: 'delivered',
      segments: 1,
      provider: 'twilio',
      providerSid: 'SM-out',
      origin: 'system',
      createdAt: '2026-09-15T11:00:00.000Z',
      sentAt: '2026-09-15T11:00:01.000Z',
      deliveredAt: '2026-09-15T11:00:05.000Z',
      updatedAt: AT,
    });
    expect(message.errorCode).toBeUndefined();
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith(
      'SM-out',
      { conversationId: 'c1', createdAt: '2026-09-15T11:00:00.000Z', messageId: message.id },
      AT,
    );
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'conversation.updated', { conversationId: 'c1' });
  });

  it('carries a failure code and queues media of an outbound MMS', async () => {
    const { service, messages, mediaQueue } = make({
      records: [outbound({ sid: 'MM-out', status: 'undelivered', errorCode: 30003, errorMessage: 'Unreachable', numMedia: '1' })],
      media: [{ sid: 'ME9', contentType: 'image/png', uri: '/x/Media/ME9.json' }],
    });
    await service.run({}, NOW);
    const { message } = messages.appendOutbound.mock.calls[0][0];
    expect(message).toMatchObject({ status: 'undelivered', errorCode: '30003', errorMessage: 'Unreachable' });
    expect(message.deliveredAt).toBeUndefined();
    expect(message.attachments).toEqual([
      { id: expect.any(String), fileName: 'ME9.png', contentType: 'image/png', status: 'pending', sourceUrl: 'https://api.twilio.com/x/Media/ME9', providerMediaSid: 'ME9' },
    ]);
    expect(mediaQueue.enqueueMediaCopy).toHaveBeenCalledWith(
      expect.objectContaining({ providerSid: 'MM-out', messageId: message.id, attachments: [expect.objectContaining({ providerMediaSid: 'ME9' })] }),
    );
  });

  it('adopts an unclaimed outbound line (same text, same recipient, no sid, close in time) instead of duplicating it', async () => {
    const unclaimed = createMockMessage({
      id: 'm-sending',
      direction: 'outbound',
      status: 'sending',
      from: OURS,
      to: CLIENT,
      body: 'On my way',
      providerSid: undefined,
      createdAt: '2026-09-15T10:58:00.000Z',
    });
    const decoy = createMockMessage({ id: 'm-other', direction: 'outbound', to: CLIENT, body: 'Different', providerSid: undefined, createdAt: '2026-09-15T10:58:00.000Z' });
    const { service, messages, mediaQueue } = make({ records: [outbound({ numSegments: '2' })], recent: [decoy, unclaimed] });
    const report = await service.run({}, NOW);

    expect(report.outbound).toEqual({ inserted: 0, adopted: 1, duplicates: 0 });
    expect(messages.appendOutbound).not.toHaveBeenCalled();
    expect(messages.updateStatus).toHaveBeenCalledWith(
      { conversationId: 'c1', createdAt: '2026-09-15T10:58:00.000Z', messageId: 'm-sending' },
      { status: 'delivered', providerSid: 'SM-out', errorCode: undefined, errorMessage: undefined, segments: 2, sentAt: '2026-09-15T11:00:01.000Z', at: AT },
    );
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith(
      'SM-out',
      { conversationId: 'c1', createdAt: '2026-09-15T10:58:00.000Z', messageId: 'm-sending' },
      AT,
    );
    expect(mediaQueue.enqueueMediaCopy).not.toHaveBeenCalled();
  });

  it('does not adopt a line that is too far in time or already has a sid', async () => {
    const stale = createMockMessage({ id: 'm-old', direction: 'outbound', to: CLIENT, body: 'On my way', providerSid: undefined, createdAt: '2026-09-15T09:00:00.000Z' });
    const claimed = createMockMessage({ id: 'm-claimed', direction: 'outbound', to: CLIENT, body: 'On my way', providerSid: 'SM-other', createdAt: '2026-09-15T10:59:00.000Z' });
    const { service, messages } = make({ records: [outbound()], recent: [stale, claimed] });
    const report = await service.run({}, NOW);
    expect(report.outbound).toEqual({ inserted: 1, adopted: 0, duplicates: 0 });
    expect(messages.updateStatus).not.toHaveBeenCalled();
  });

  it('a rerun that finds the CLIENTMSG#reconcile guard re-points PSID# at the line written last time', async () => {
    const { service, messages } = make({
      records: [outbound()],
      appendDuplicate: { conversationId: 'c1', messageSk: 'MSG#2026-09-15T11:00:00.000Z#m-prev' },
    });
    const report = await service.run({}, NOW);
    expect(report.outbound).toEqual({ inserted: 0, adopted: 0, duplicates: 1 });
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith(
      'SM-out',
      { conversationId: 'c1', createdAt: '2026-09-15T11:00:00.000Z', messageId: 'm-prev' },
      AT,
    );
  });
});
