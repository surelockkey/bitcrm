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

/** Where the `PSID#` pointer of a known sid points (the stored line of the status-sync tests). */
const KNOWN_SK = 'MSG#2026-09-15T10:58:00.000Z#m-out';
const KNOWN_KEY = { conversationId: 'c1', createdAt: '2026-09-15T10:58:00.000Z', messageId: 'm-out' };

function make(opts: {
  records?: unknown[];
  media?: Array<{ sid: string; contentType: string; uri: string }>;
  known?: string[];
  ingest?: 'stored' | 'duplicate';
  recent?: Message[];
  appendDuplicate?: { conversationId: string; messageSk: string };
  updateApplied?: boolean;
  /** The line a `PSID#` pointer / a key resolves to (`get`, `getBySk`). */
  stored?: Message | null;
  /** What `client.messages(sid).fetch()` answers. */
  fetched?: unknown;
} = {}) {
  const conversation = createMockConversation({ id: 'c1' });
  const client = {
    messages: Object.assign(
      jest.fn(() => ({
        media: { list: jest.fn().mockResolvedValue(opts.media ?? []) },
        fetch: jest.fn().mockResolvedValue(opts.fetched),
      })),
      { list: jest.fn().mockResolvedValue(opts.records ?? []) },
    ),
  };
  const twilioRest = { run: jest.fn((fn: (c: unknown) => Promise<unknown>) => fn(client)) };
  const inbound = {
    ingest: jest.fn().mockResolvedValue({ outcome: opts.ingest ?? 'stored', conversationId: 'c1' }),
    locateConversation: jest.fn().mockResolvedValue({ conversation, created: false }),
  };
  const messages = {
    getProviderSidPointer: jest.fn(async (sid: string) =>
      (opts.known ?? []).includes(sid) ? { providerSid: sid, conversationId: 'c1', messageSk: KNOWN_SK, createdAt: AT } : null,
    ),
    get: jest.fn(async () => opts.stored ?? null),
    getBySk: jest.fn(async () => opts.stored ?? null),
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
  const realtime = { messageUpserted: jest.fn() };
  const service = new ReconcileService(
    twilioRest as unknown as TwilioRest,
    inbound as unknown as InboundService,
    messages as unknown as MessagesRepository,
    mediaQueue as unknown as MediaQueueService,
    sns as never,
    realtime as never,
  );
  return { service, client, twilioRest, inbound, messages, mediaQueue, sns, realtime, conversation };
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

// ---------------------------------------------------------------------------
// Known sid: the status sync (a status callback that never arrived)
// ---------------------------------------------------------------------------
const stored = (over: Partial<Message> = {}): Message =>
  createMockMessage({
    id: 'm-out',
    direction: 'outbound',
    status: 'sent',
    from: OURS,
    to: CLIENT,
    body: 'On my way',
    providerSid: 'SM-out',
    origin: 'user',
    sentByUserId: 'u1',
    createdAt: '2026-09-15T10:58:00.000Z',
    updatedAt: '2026-09-15T10:58:02.000Z',
    ...over,
  });

const known = (over: Record<string, unknown> = {}) =>
  twilioMessage({ sid: 'SM-out', direction: 'outbound-api', from: OURS, to: CLIENT, body: 'On my way', status: 'delivered', ...over });

describe('ReconcileService.run — known sid, Twilio further along', () => {
  it('writes Twilio’s status as the callback would have, publishes status_changed + conversation.updated, pushes realtime', async () => {
    const { service, messages, inbound, sns, realtime } = make({ records: [known()], known: ['SM-out'], stored: stored() });
    const report = await service.run({}, NOW);

    expect(report).toMatchObject({ scanned: 1, skipped: 0, synced: 1, failed: 0, outbound: { inserted: 0, adopted: 0, duplicates: 0 } });
    expect(inbound.locateConversation).not.toHaveBeenCalled();
    expect(messages.appendOutbound).not.toHaveBeenCalled();
    expect(messages.putProviderSidPointer).not.toHaveBeenCalled();
    expect(messages.getBySk).toHaveBeenCalledWith('c1', KNOWN_SK);
    expect(messages.updateStatus).toHaveBeenCalledWith(KNOWN_KEY, {
      status: 'delivered',
      providerSid: 'SM-out',
      errorCode: undefined,
      errorMessage: undefined,
      segments: 1,
      sentAt: '2026-09-15T11:00:01.000Z',
      deliveredAt: '2026-09-15T11:00:05.000Z',
      at: AT,
    });
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'message.status_changed', { messageId: 'm-out', conversationId: 'c1', status: 'delivered' });
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'conversation.updated', { conversationId: 'c1' });
    expect(realtime.messageUpserted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-out', status: 'delivered', providerSid: 'SM-out', sentAt: '2026-09-15T11:00:01.000Z', deliveredAt: '2026-09-15T11:00:05.000Z', updatedAt: AT }),
      undefined,
      AT,
    );
  });

  it('a failure carries the code and the readable text — 21408 geo permission, from Twilio’s words when it gives any', async () => {
    const ours = make({ records: [known({ status: 'failed', errorCode: 21408, errorMessage: null })], known: ['SM-out'], stored: stored({ status: 'sending' }) });
    expect(await ours.service.run({}, NOW)).toMatchObject({ synced: 1, skipped: 0 });
    expect(ours.messages.updateStatus).toHaveBeenCalledWith(
      KNOWN_KEY,
      expect.objectContaining({ status: 'failed', errorCode: '21408', errorMessage: 'Sending to this region is not enabled on the account', deliveredAt: undefined }),
    );
    expect(ours.sns.publish).toHaveBeenCalledWith('message-events', 'message.status_changed', { messageId: 'm-out', conversationId: 'c1', status: 'failed', errorCode: '21408' });
    expect(ours.realtime.messageUpserted).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorCode: '21408', errorMessage: 'Sending to this region is not enabled on the account' }), undefined, AT);

    const theirs = make({
      records: [known({ status: 'undelivered', errorCode: 30003, errorMessage: 'Unreachable destination handset' })],
      known: ['SM-out'],
      stored: stored(),
    });
    await theirs.service.run({}, NOW);
    expect(theirs.messages.updateStatus).toHaveBeenCalledWith(KNOWN_KEY, expect.objectContaining({ status: 'undelivered', errorCode: '30003', errorMessage: 'Unreachable destination handset' }));
  });

  it('leaves a line alone when Twilio is not further along: same rank or behind is skipped, nothing written or published', async () => {
    const same = make({ records: [known()], known: ['SM-out'], stored: stored({ status: 'delivered' }) });
    expect(await same.service.run({}, NOW)).toMatchObject({ scanned: 1, skipped: 1, synced: 0 });
    expect(same.messages.updateStatus).not.toHaveBeenCalled();
    expect(same.sns.publish).not.toHaveBeenCalled();
    expect(same.realtime.messageUpserted).not.toHaveBeenCalled();

    const behind = make({ records: [known({ status: 'sent' })], known: ['SM-out'], stored: stored({ status: 'delivered' }) });
    expect(await behind.service.run({}, NOW)).toMatchObject({ skipped: 1, synced: 0 });
    expect(behind.messages.updateStatus).not.toHaveBeenCalled();

    // a terminal never yields to another terminal (failed stays failed)
    const terminal = make({ records: [known({ status: 'delivered' })], known: ['SM-out'], stored: stored({ status: 'failed', errorCode: '30007' }) });
    expect(await terminal.service.run({}, NOW)).toMatchObject({ skipped: 1, synced: 0 });
    expect(terminal.messages.updateStatus).not.toHaveBeenCalled();
  });

  it('does not even read the line when Twilio’s status could not outrank a sent one, nor for an inbound record', async () => {
    const early = make({ records: [known({ status: 'sending' }), known({ sid: 'SM-q', status: 'queued' }), known({ sid: 'SM-a', status: 'accepted' })], known: ['SM-out', 'SM-q', 'SM-a'], stored: stored({ status: 'sending' }) });
    expect(await early.service.run({}, NOW)).toMatchObject({ scanned: 3, skipped: 3, synced: 0 });
    expect(early.messages.getBySk).not.toHaveBeenCalled();

    const inbound = make({ records: [twilioMessage({ sid: 'SM-in' })], known: ['SM-in'], stored: stored() });
    expect(await inbound.service.run({}, NOW)).toMatchObject({ skipped: 1, synced: 0 });
    expect(inbound.messages.getBySk).not.toHaveBeenCalled();
    expect(inbound.inbound.ingest).not.toHaveBeenCalled();
  });

  it('skips a line that is not an outbound Twilio SMS of this account, or that the pointer no longer resolves', async () => {
    const email = make({ records: [known()], known: ['SM-out'], stored: stored({ channel: 'email', provider: 'ses' }) });
    expect(await email.service.run({}, NOW)).toMatchObject({ skipped: 1, synced: 0 });
    expect(email.messages.updateStatus).not.toHaveBeenCalled();

    const imported = make({ records: [known()], known: ['SM-out'], stored: stored({ providerAccount: 'workiz' }) });
    expect(await imported.service.run({}, NOW)).toMatchObject({ skipped: 1, synced: 0 });

    const gone = make({ records: [known()], known: ['SM-out'], stored: null });
    expect(await gone.service.run({}, NOW)).toMatchObject({ skipped: 1, synced: 0, failed: 0 });
    expect(gone.messages.updateStatus).not.toHaveBeenCalled();
  });

  it('when the callback won the race (rank guard refused the write) nothing is published and the line counts as skipped', async () => {
    const { service, sns, realtime } = make({ records: [known()], known: ['SM-out'], stored: stored(), updateApplied: false });
    expect(await service.run({}, NOW)).toMatchObject({ skipped: 1, synced: 0 });
    expect(sns.publish).not.toHaveBeenCalled();
    expect(realtime.messageUpserted).not.toHaveBeenCalled();
  });

  it('a failing sync counts as failed for that sid and the run goes on', async () => {
    const { service, messages } = make({ records: [known(), twilioMessage({ sid: 'SM-new' })], known: ['SM-out'], stored: stored() });
    messages.updateStatus.mockRejectedValueOnce(new Error('dynamo down'));
    const report = await service.run({}, NOW);
    expect(report).toMatchObject({ scanned: 2, failed: 1, synced: 0, inbound: { inserted: 1, duplicates: 0 } });
    expect(report.errors).toEqual([{ sid: 'SM-out', error: 'dynamo down' }]);
  });
});

describe('ReconcileService.syncMessage — one line by its sid', () => {
  it('fetches the sid from Twilio and applies an outranking status, answering the line as it is now', async () => {
    const { service, client, messages, sns, realtime } = make({
      stored: stored({ status: 'sending' }),
      fetched: known({ status: 'undelivered', errorCode: 30003, errorMessage: 'Unreachable destination handset' }),
    });
    const result = await service.syncMessage(KNOWN_KEY, NOW);

    expect(messages.get).toHaveBeenCalledWith(KNOWN_KEY);
    expect(client.messages).toHaveBeenCalledWith('SM-out');
    expect(messages.updateStatus).toHaveBeenCalledWith(
      KNOWN_KEY,
      expect.objectContaining({ status: 'undelivered', providerSid: 'SM-out', errorCode: '30003', errorMessage: 'Unreachable destination handset', at: AT }),
    );
    expect(result).toMatchObject({
      outcome: 'synced',
      providerStatus: 'undelivered',
      message: expect.objectContaining({ id: 'm-out', status: 'undelivered', errorCode: '30003', errorMessage: 'Unreachable destination handset', updatedAt: AT }),
    });
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'message.status_changed', { messageId: 'm-out', conversationId: 'c1', status: 'undelivered', errorCode: '30003' });
    expect(realtime.messageUpserted).toHaveBeenCalledWith(result.message, undefined, AT);
  });

  it('answers unchanged when Twilio has nothing newer, and does not ask at all about a line already terminal', async () => {
    const same = make({ stored: stored(), fetched: known({ status: 'sent' }) });
    expect(await same.service.syncMessage(KNOWN_KEY, NOW)).toEqual({ outcome: 'unchanged', message: stored(), providerStatus: 'sent' });
    expect(same.messages.updateStatus).not.toHaveBeenCalled();

    const done = make({ stored: stored({ status: 'delivered' }) });
    expect(await done.service.syncMessage(KNOWN_KEY, NOW)).toEqual({ outcome: 'unchanged', message: stored({ status: 'delivered' }) });
    expect(done.client.messages).not.toHaveBeenCalled();
    expect(done.twilioRest.run).not.toHaveBeenCalled();
  });

  it('answers not_found, no_provider_sid and not_syncable without calling Twilio', async () => {
    const missing = make({ stored: null });
    expect(await missing.service.syncMessage(KNOWN_KEY, NOW)).toEqual({ outcome: 'not_found' });

    const unsent = make({ stored: stored({ status: 'queued', providerSid: undefined }) });
    expect(await unsent.service.syncMessage(KNOWN_KEY, NOW)).toMatchObject({ outcome: 'no_provider_sid' });

    const inbound = make({ stored: createMockMessage() });
    expect(await inbound.service.syncMessage(KNOWN_KEY, NOW)).toMatchObject({ outcome: 'not_syncable' });
    const email = make({ stored: stored({ channel: 'email', provider: 'ses', providerSid: '<id@ses>' }) });
    expect(await email.service.syncMessage(KNOWN_KEY, NOW)).toMatchObject({ outcome: 'not_syncable' });
    const inApp = make({ stored: stored({ channel: 'in_app', provider: undefined, providerSid: undefined }) });
    expect(await inApp.service.syncMessage(KNOWN_KEY, NOW)).toMatchObject({ outcome: 'not_syncable' });

    for (const { twilioRest } of [missing, unsent, inbound, email, inApp]) expect(twilioRest.run).not.toHaveBeenCalled();
  });

  it('lets a Twilio failure propagate (the caller decides whether to retry)', async () => {
    const { service, client } = make({ stored: stored() });
    client.messages.mockImplementationOnce(() => ({ media: { list: jest.fn() }, fetch: jest.fn().mockRejectedValue(new Error('Twilio 503')) }));
    await expect(service.syncMessage(KNOWN_KEY, NOW)).rejects.toThrow('Twilio 503');
  });
});
