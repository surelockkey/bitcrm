import { type Message } from '@bitcrm/types';
import { OutboundWorker, type TwilioCreateParams, type TwilioMessageResult } from '../../../src/outbound/outbound.worker';
import { createMockMessage, T1 } from '../mocks';

const job = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };

const queued = (overrides: Partial<Message> = {}): Message =>
  createMockMessage({
    id: 'm2',
    direction: 'outbound',
    status: 'queued',
    from: '+15550001111',
    to: '+14045551234',
    body: 'On my way',
    providerSid: undefined,
    origin: 'user',
    sentByUserId: 'u1',
    dealId: 'd1',
    ...overrides,
  });

const accepted = (overrides: Partial<TwilioMessageResult> = {}): TwilioMessageResult => ({
  sid: 'SM2',
  status: 'queued',
  numSegments: '1',
  from: '+15550001111',
  to: '+14045551234',
  body: 'On my way',
  direction: 'outbound-api',
  dateCreated: new Date('2026-09-15T10:05:01.000Z'),
  ...overrides,
});

function makeWorker(opts: {
  message?: Message | null;
  claim?: boolean;
  create?: TwilioMessageResult | Error;
  list?: TwilioMessageResult[] | Error;
  pointerNew?: boolean;
  publicBaseUrl?: string;
  messagingServiceSid?: string;
  /** M17: the email worker `email` jobs are handed to. */
  email?: { process: jest.Mock };
} = {}) {
  const message = opts.message === undefined ? queued() : opts.message;
  const messages = {
    get: jest.fn(async () => message),
    markSending: jest.fn(async () => opts.claim ?? true),
    putProviderSidPointer: jest.fn(async () => opts.pointerNew ?? true),
    updateStatus: jest.fn(async () => true),
  };
  const outbound = { attachProviderSid: jest.fn(async () => true) };
  const optOuts = { setStatus: jest.fn(async () => ({})) };
  const events = {
    messageSent: jest.fn(async () => undefined),
    statusChanged: jest.fn(async () => undefined),
    conversationUpdated: jest.fn(async () => undefined),
    optOutChanged: jest.fn(async () => undefined),
  };
  const api = {
    create: jest.fn(async (_params: TwilioCreateParams) => {
      if (opts.create instanceof Error) throw opts.create;
      return opts.create ?? accepted();
    }),
    list: jest.fn(async (_params: { to?: string; from?: string; limit?: number }) => {
      if (opts.list instanceof Error) throw opts.list;
      return opts.list ?? [];
    }),
  };
  const rest = { client: { messages: api } };
  const attachments = {
    mediaUrlsFor: jest.fn(async (m: Message) =>
      (m.attachments ?? []).filter((a) => a.status === 'stored' && a.s3Key).map((a) => `https://s3/get/${a.s3Key}`),
    ),
  };
  const pending = { track: jest.fn() };
  const worker = new OutboundWorker(
    messages as any,
    outbound as any,
    optOuts as any,
    events as any,
    rest as any,
    { messagingServiceSid: opts.messagingServiceSid ?? 'MG1', publicBaseUrl: opts.publicBaseUrl ?? 'https://crm.example.com' },
    attachments as any,
    undefined,
    opts.email as any,
    pending as any,
  );
  return { worker, messages, outbound, optOuts, events, api, attachments, pending };
}

const twilioError = (status: number, code: number, message: string) => Object.assign(new Error(message), { status, code });

describe('OutboundWorker.process — the happy path', () => {
  it('claims the message, creates it through the Messaging Service with the status callback, and records the sid', async () => {
    const { worker, messages, outbound, api, events } = makeWorker();
    await worker.process(job);

    expect(messages.markSending).toHaveBeenCalledWith(job);
    expect(api.create).toHaveBeenCalledWith({
      messagingServiceSid: 'MG1',
      from: '+15550001111',
      to: '+14045551234',
      body: 'On my way',
      statusCallback: `https://crm.example.com/api/messaging/webhooks/twilio/status?c=c1&t=${encodeURIComponent(T1)}&m=m2`,
    });
    expect(api.list).not.toHaveBeenCalled();
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith('SM2', job);
    expect(outbound.attachProviderSid).toHaveBeenCalledWith(job, { providerSid: 'SM2', segments: 1, from: '+15550001111' });
    // Twilio said `queued`: the rank-guarded status stays `sending` until the callback
    expect(messages.updateStatus).not.toHaveBeenCalled();
    expect(events.messageSent).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }), 'SM2');
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('applies a status that already outranks sending (sent / delivered) from the create response', async () => {
    const { worker, messages, events } = makeWorker({ create: accepted({ status: 'sent', numSegments: '3' }) });
    await worker.process(job);
    expect(messages.updateStatus).toHaveBeenCalledWith(job, { status: 'sent', providerSid: 'SM2', errorCode: undefined, errorMessage: undefined });
    expect(events.statusChanged).not.toHaveBeenCalled();

    const delivered = makeWorker({ create: accepted({ status: 'delivered' }) });
    await delivered.worker.process(job);
    expect(delivered.events.statusChanged).toHaveBeenCalledWith(job, 'delivered', undefined);
  });

  it('omits the status callback without PUBLIC_BASE_URL and the pool sid without a Messaging Service', async () => {
    const { worker, api } = makeWorker({ publicBaseUrl: '', messagingServiceSid: '' });
    await worker.process(job);
    expect(api.create).toHaveBeenCalledWith({ from: '+15550001111', to: '+14045551234', body: 'On my way' });
  });

  it('hands Twilio presigned GET URLs for the stored attachments as mediaUrl', async () => {
    const withMedia = queued({
      attachments: [
        { id: 'a1', fileName: '1.jpg', contentType: 'image/jpeg', size: 10, status: 'stored', s3Key: 'messaging/uploads/u1/a1' },
        { id: 'a2', fileName: '2.jpg', contentType: 'image/jpeg', size: 10, status: 'pending' },
      ],
    });
    const { worker, api, attachments } = makeWorker({ message: withMedia });
    await worker.process(job);
    expect(attachments.mediaUrlsFor).toHaveBeenCalledWith(withMedia);
    expect(api.create.mock.calls[0][0]).toMatchObject({ mediaUrl: ['https://s3/get/messaging/uploads/u1/a1'] });

    const { api: plain } = makeWorker();
    await makeWorker().worker.process(job);
    expect(plain.create.mock.calls[0]?.[0] ?? {}).not.toHaveProperty('mediaUrl');
  });

  it('retries (rethrows) when the media URLs cannot be presigned, before calling Twilio', async () => {
    const { worker, api, attachments } = makeWorker({ message: queued({ attachments: [{ id: 'a1', fileName: '1.jpg', contentType: 'image/jpeg', status: 'stored', s3Key: 'k' }] }) });
    attachments.mediaUrlsFor.mockRejectedValueOnce(new Error('S3 unreachable'));
    await expect(worker.process(job)).rejects.toThrow('S3 unreachable');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('lets the pool pick the sender when the message has no from', async () => {
    const { worker, api, outbound } = makeWorker({ message: queued({ from: undefined, businessNumber: undefined, senderSource: 'pool' }), create: accepted({ from: '+15550009999' }) });
    await worker.process(job);
    expect(api.create.mock.calls[0][0]).not.toHaveProperty('from');
    expect(outbound.attachProviderSid).toHaveBeenCalledWith(job, expect.objectContaining({ from: '+15550009999' }));
  });
});

describe('OutboundWorker.process — failures', () => {
  it('21610 marks the message failed, records the opt-out and publishes both events', async () => {
    const { worker, messages, optOuts, events, api } = makeWorker({ create: twilioError(400, 21610, 'Attempt to send to unsubscribed recipient') });
    await worker.process(job);

    expect(messages.updateStatus).toHaveBeenCalledWith(job, {
      status: 'failed',
      providerSid: undefined,
      errorCode: '21610',
      errorMessage: 'Attempt to send to unsubscribed recipient',
    });
    expect(optOuts.setStatus).toHaveBeenCalledWith({ channel: 'sms', address: '+14045551234', status: 'opted_out', source: 'error_21610', messagingServiceSid: 'MG1' });
    expect(events.optOutChanged).toHaveBeenCalledWith({ channel: 'sms', address: '+14045551234', status: 'opted_out', source: 'error_21610' });
    expect(events.statusChanged).toHaveBeenCalledWith(job, 'failed', '21610');
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it('an invalid number (21211) fails without retry and without an opt-out', async () => {
    const { worker, messages, optOuts } = makeWorker({ create: twilioError(400, 21211, "The 'To' number is not a valid phone number.") });
    await expect(worker.process(job)).resolves.toBeUndefined();
    expect(messages.updateStatus).toHaveBeenCalledWith(job, expect.objectContaining({ status: 'failed', errorCode: '21211' }));
    expect(optOuts.setStatus).not.toHaveBeenCalled();
  });

  it('a 429 or 5xx rethrows so SQS redelivers, leaving the message in sending', async () => {
    const throttled = makeWorker({ create: twilioError(429, 20429, 'Too Many Requests') });
    await expect(throttled.worker.process(job)).rejects.toThrow('Too Many Requests');
    expect(throttled.messages.updateStatus).not.toHaveBeenCalled();

    const down = makeWorker({ create: twilioError(503, 20503, 'Service Unavailable') });
    await expect(down.worker.process(job)).rejects.toThrow('Service Unavailable');

    const network = makeWorker({ create: new Error('ECONNRESET') });
    await expect(network.worker.process(job)).rejects.toThrow('ECONNRESET');
  });
});

describe('OutboundWorker.process — idempotency', () => {
  it('drops a job whose message is gone, not outbound, or already terminal', async () => {
    const gone = makeWorker({ message: null });
    await gone.worker.process(job);
    expect(gone.api.create).not.toHaveBeenCalled();

    const inbound = makeWorker({ message: createMockMessage() });
    await inbound.worker.process(job);
    expect(inbound.api.create).not.toHaveBeenCalled();

    const failed = makeWorker({ message: queued({ status: 'failed' }) });
    await failed.worker.process(job);
    expect(failed.messages.markSending).not.toHaveBeenCalled();
  });

  it('only re-puts the PSID# pointer when the message already carries a sid', async () => {
    const { worker, messages, api } = makeWorker({ message: queued({ status: 'sending', providerSid: 'SM2' }) });
    await worker.process(job);
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith('SM2', job);
    expect(messages.markSending).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('when the claim fails on a fresh message, another worker has it: nothing happens', async () => {
    const { worker, api, messages } = makeWorker({ claim: false });
    await worker.process(job);
    expect(api.list).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(messages.updateStatus).not.toHaveBeenCalled();
  });

  it('after a dead attempt, adopts the message Twilio already has instead of sending twice', async () => {
    const dead = queued({ status: 'sending', sendingStartedAt: '2026-09-15T10:05:00.500Z' });
    const earlier = accepted({ sid: 'SM1st', status: 'sent', dateCreated: new Date('2026-09-15T10:05:00.900Z') });
    const other = accepted({ sid: 'SMother', body: 'Something else', dateCreated: new Date('2026-09-15T10:05:00.900Z') });
    const old = accepted({ sid: 'SMold', dateCreated: new Date('2026-09-15T09:00:00.000Z') });
    const { worker, api, messages, outbound } = makeWorker({ message: dead, claim: false, list: [other, old, earlier] });
    await worker.process(job);

    expect(api.list).toHaveBeenCalledWith({ to: '+14045551234', from: '+15550001111', limit: 20 });
    expect(api.create).not.toHaveBeenCalled();
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith('SM1st', job);
    expect(outbound.attachProviderSid).toHaveBeenCalledWith(job, expect.objectContaining({ providerSid: 'SM1st' }));
    expect(messages.updateStatus).toHaveBeenCalledWith(job, expect.objectContaining({ status: 'sent', providerSid: 'SM1st' }));
  });

  it('after a dead attempt that never reached Twilio (or an unreadable log), sends', async () => {
    const dead = queued({ status: 'sending', sendingStartedAt: '2026-09-15T10:05:00.500Z' });
    const nothing = makeWorker({ message: dead, claim: false, list: [] });
    await nothing.worker.process(job);
    expect(nothing.api.create).toHaveBeenCalledTimes(1);

    const unreadable = makeWorker({ message: dead, claim: false, list: new Error('429') });
    await unreadable.worker.process(job);
    expect(unreadable.api.create).toHaveBeenCalledTimes(1);
  });

  it('does not re-publish message.sent when the PSID# pointer already existed', async () => {
    const { worker, events } = makeWorker({ pointerNew: false });
    await worker.process(job);
    expect(events.messageSent).not.toHaveBeenCalled();
    expect(events.conversationUpdated).toHaveBeenCalled();
  });
});

describe('OutboundWorker.process — the pending-status set (status-sync poller)', () => {
  it('remembers a line Twilio accepted without a terminal status, so the poller can follow up', async () => {
    const { worker, pending } = makeWorker();
    await worker.process(job);
    expect(pending.track).toHaveBeenCalledWith(job);

    const sent = makeWorker({ create: accepted({ status: 'sent' }) });
    await sent.worker.process(job);
    expect(sent.pending.track).toHaveBeenCalledWith(job);

    const adopted = makeWorker({
      message: queued({ status: 'sending', sendingStartedAt: '2026-09-15T10:05:00.500Z' }),
      claim: false,
      list: [accepted({ sid: 'SM1st', dateCreated: new Date('2026-09-15T10:05:00.900Z') })],
    });
    await adopted.worker.process(job);
    expect(adopted.pending.track).toHaveBeenCalledWith(job);
  });

  it('does not remember a line whose create response was already terminal, nor a refused one', async () => {
    const failed = makeWorker({ create: accepted({ status: 'failed', errorCode: 21408 }) });
    await failed.worker.process(job);
    expect(failed.pending.track).not.toHaveBeenCalled();

    const refused = makeWorker({ create: twilioError(400, 21211, "The 'To' number is not a valid phone number.") });
    await refused.worker.process(job);
    expect(refused.pending.track).not.toHaveBeenCalled();
  });
});

describe('OutboundWorker.process — email hand-off (M17)', () => {
  const email = () => queued({ channel: 'email', to: 'jane@example.com', from: 'office@example.com', businessNumber: undefined, provider: 'ses' });

  it('hands an email job to the email worker without touching Twilio or the SMS claim', async () => {
    const emailWorker = { process: jest.fn(async () => undefined) };
    const message = email();
    const { worker, api, messages } = makeWorker({ message, email: emailWorker });
    await worker.process(job);
    expect(emailWorker.process).toHaveBeenCalledWith(message, job);
    expect(messages.markSending).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('leaves an email job alone (queued, retried later) when no email worker is wired', async () => {
    const { worker, api, messages } = makeWorker({ message: email() });
    await worker.process(job);
    expect(messages.markSending).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('lets an email worker failure propagate so SQS redelivers', async () => {
    const emailWorker = { process: jest.fn(async () => { throw new Error('SES throttled'); }) };
    const { worker } = makeWorker({ message: email(), email: emailWorker });
    await expect(worker.process(job)).rejects.toThrow('SES throttled');
  });
});

describe('OutboundWorker.handle', () => {
  it('drops a malformed payload instead of retrying it forever', async () => {
    const { worker, messages } = makeWorker();
    await worker.handle({ nope: true });
    await worker.handle(null);
    expect(messages.get).not.toHaveBeenCalled();
    await worker.handle(job);
    expect(messages.get).toHaveBeenCalledWith(job);
  });
});
