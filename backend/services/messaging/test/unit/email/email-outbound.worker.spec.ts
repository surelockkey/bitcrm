import { type Message } from '@bitcrm/types';
import { EMAIL_NOT_CONFIGURED_CODE, EmailOutboundWorker } from '../../../src/email/email-outbound.worker';
import { type EmailSendResult, type OutboundEmail } from '../../../src/email/email-sender';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

const job = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };

const queued = (over: Partial<Message> = {}): Message =>
  createMockMessage({
    id: 'm2',
    channel: 'email',
    direction: 'outbound',
    status: 'queued',
    from: 'office@example.com',
    to: 'jane@example.com',
    subject: 'Your key',
    body: 'Hi Jane',
    bodyHtml: '<p>Hi Jane</p>',
    businessNumber: undefined,
    providerSid: undefined,
    provider: 'ses',
    origin: 'user',
    sentByUserId: 'u1',
    ...over,
  });

function make(opts: {
  message?: Message | null;
  fresh?: Message | null;
  claim?: boolean;
  send?: EmailSendResult | Error;
  sender?: { from: string; fromHeader: string; replyTo?: string } | null;
  pointerNew?: boolean;
  /** M18: ADDR# already points somewhere (no pointer written) or not. */
  addressPointer?: { conversationId: string } | null;
} = {}) {
  const message = opts.message === undefined ? queued() : opts.message;
  const messages = {
    get: jest.fn(async () => opts.fresh === undefined ? message : opts.fresh),
    markSending: jest.fn(async () => opts.claim ?? true),
    putProviderSidPointer: jest.fn(async () => opts.pointerNew ?? true),
    updateStatus: jest.fn(async () => true),
  };
  const emailMessages = { attachSesMessageId: jest.fn(async () => true) };
  const addresses = {
    resolve: jest.fn(async () =>
      opts.sender === undefined
        ? { from: 'office@example.com', fromHeader: '"Sure Lock" <office@example.com>', replyTo: 'c-c1@reply.example.com' }
        : opts.sender,
    ),
  };
  const sender = {
    send: jest.fn(async (_e: OutboundEmail) => {
      if (opts.send instanceof Error) throw opts.send;
      return opts.send ?? { messageId: 'ses-1', attachments: 'none' as const };
    }),
  };
  const events = {
    messageSent: jest.fn(async () => undefined),
    statusChanged: jest.fn(async () => undefined),
    conversationUpdated: jest.fn(async () => undefined),
  };
  const realtime = { messageUpserted: jest.fn() };
  const conversations = {
    getByAddress: jest.fn(async () => (opts.addressPointer === undefined ? null : opts.addressPointer)),
    get: jest.fn(async () => createMockConversation({ id: 'c1', addresses: { phones: [], emails: ['jane@example.com'] } })),
    putAddressPointer: jest.fn(async () => undefined),
  };
  const worker = new EmailOutboundWorker(
    messages as any,
    emailMessages as any,
    addresses as any,
    sender as any,
    events as any,
    { awsRegion: 'us-east-1' },
    realtime as any,
    conversations as any,
  );
  return { worker, messages, emailMessages, addresses, sender, events, realtime, conversations };
}

const sesError = (name: string, status: number, message = name) => Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });

describe('EmailOutboundWorker.process — the happy path', () => {
  it('claims, resolves the sender, sends with the reply token, records the SES id and marks it sent', async () => {
    const { worker, messages, emailMessages, sender, events, realtime, addresses } = make();
    await worker.process(queued({ inReplyTo: '<prev@mail>', references: ['<prev@mail>'], cc: ['boss@example.com'] }), job);

    expect(messages.markSending).toHaveBeenCalledWith(job);
    expect(addresses.resolve).toHaveBeenCalledWith('c1');
    expect(sender.send).toHaveBeenCalledWith({
      conversationId: 'c1',
      messageId: 'm2',
      createdAt: T1,
      from: 'office@example.com',
      fromHeader: '"Sure Lock" <office@example.com>',
      replyTo: 'c-c1@reply.example.com',
      to: 'jane@example.com',
      cc: ['boss@example.com'],
      subject: 'Your key',
      text: 'Hi Jane',
      html: '<p>Hi Jane</p>',
      inReplyTo: '<prev@mail>',
      references: ['<prev@mail>'],
      attachments: undefined,
    });
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith('ses-1', job);
    expect(emailMessages.attachSesMessageId).toHaveBeenCalledWith(job, {
      providerSid: 'ses-1',
      emailMessageId: '<ses-1@email.amazonses.com>',
      from: 'office@example.com',
    });
    expect(messages.updateStatus).toHaveBeenCalledWith(job, { status: 'sent', providerSid: 'ses-1', errorCode: undefined, errorMessage: undefined });
    expect(events.messageSent).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2', channel: 'email' }), 'ses-1');
    expect(events.statusChanged).not.toHaveBeenCalled(); // sent is not terminal
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
    expect(realtime.messageUpserted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm2', status: 'sent', providerSid: 'ses-1', emailMessageId: '<ses-1@email.amazonses.com>' }),
      undefined,
      expect.any(String),
    );
  });

  it('derives the missing body rendering: html from text, text from html', async () => {
    const textOnly = make();
    await textOnly.worker.process(queued({ bodyHtml: undefined, body: 'Hi\nJane' }), job);
    expect(textOnly.sender.send.mock.calls[0][0]).toMatchObject({ text: 'Hi\nJane', html: '<p>Hi<br>Jane</p>' });

    const htmlOnly = make();
    await htmlOnly.worker.process(queued({ body: undefined, bodyHtml: '<p>Only <b>html</b></p>' }), job);
    expect(htmlOnly.sender.send.mock.calls[0][0]).toMatchObject({ text: 'Only html', html: '<p>Only <b>html</b></p>' });

    const blank = make();
    await blank.worker.process(queued({ body: undefined, bodyHtml: undefined, subject: '  ' }), job);
    expect(blank.sender.send.mock.calls[0][0]).toMatchObject({ text: '', html: undefined, subject: '(no subject)' });
  });

  it('keeps the address stored at accept time when settings changed since, using it bare in the header', async () => {
    const { worker, sender } = make({ sender: { from: 'sales@example.com', fromHeader: '"Sales" <sales@example.com>' } });
    await worker.process(queued({ from: 'office@example.com' }), job);
    expect(sender.send.mock.calls[0][0]).toMatchObject({ from: 'office@example.com', fromHeader: 'office@example.com', replyTo: undefined });
  });

  it('points ADDR#<recipient> at the conversation after a send, once, so a fresh mail back routes here', async () => {
    const first = make();
    await first.worker.process(queued(), job);
    expect(first.conversations.getByAddress).toHaveBeenCalledWith('jane@example.com');
    expect(first.conversations.putAddressPointer).toHaveBeenCalledWith({
      address: 'jane@example.com',
      conversationId: 'c1',
      partyKind: 'contact',
      partyId: 'ct1',
      source: 'crm',
      updatedAt: expect.any(String),
    });

    const pointed = make({ addressPointer: { conversationId: 'c1' } });
    await pointed.worker.process(queued(), job);
    expect(pointed.conversations.putAddressPointer).not.toHaveBeenCalled();

    // best effort: a failing pointer write never fails the send
    const broken = make();
    broken.conversations.putAddressPointer.mockRejectedValueOnce(new Error('dynamo down'));
    await expect(broken.worker.process(queued(), job)).resolves.toBeUndefined();
    expect(broken.messages.updateStatus).toHaveBeenCalledWith(job, expect.objectContaining({ status: 'sent' }));
  });

  it('does not re-publish message.sent when the PSID# pointer already existed', async () => {
    const { worker, events } = make({ pointerNew: false });
    await worker.process(queued(), job);
    expect(events.messageSent).not.toHaveBeenCalled();
    expect(events.conversationUpdated).toHaveBeenCalled();
  });
});

describe('EmailOutboundWorker.process — failures', () => {
  it('a stable SES refusal marks the message failed with the exception name and publishes', async () => {
    const { worker, messages, events } = make({ send: sesError('MessageRejected', 400, 'Email address is not verified') });
    await worker.process(queued(), job);
    expect(messages.updateStatus).toHaveBeenCalledWith(job, {
      status: 'failed',
      providerSid: undefined,
      errorCode: 'MessageRejected',
      errorMessage: 'SES rejected the message: Email address is not verified',
    });
    expect(events.statusChanged).toHaveBeenCalledWith(job, 'failed', 'MessageRejected');
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('throttling, 5xx and network failures rethrow so SQS redelivers, leaving the message in sending', async () => {
    for (const error of [sesError('TooManyRequestsException', 429), sesError('InternalFailure', 500), new Error('ECONNRESET')]) {
      const { worker, messages } = make({ send: error });
      await expect(worker.process(queued(), job)).rejects.toThrow(error.message);
      expect(messages.updateStatus).not.toHaveBeenCalled();
    }
  });

  it('no configured sender at send time is a stable failure, not a retry', async () => {
    const { worker, messages, sender } = make({ sender: null });
    await worker.process(queued({ from: undefined }), job);
    expect(sender.send).not.toHaveBeenCalled();
    expect(messages.updateStatus).toHaveBeenCalledWith(job, expect.objectContaining({ status: 'failed', errorCode: EMAIL_NOT_CONFIGURED_CODE }));
  });
});

describe('EmailOutboundWorker.process — idempotency', () => {
  it('drops what is not a deliverable outbound email', async () => {
    const inbound = make();
    await inbound.worker.process(createMockMessage({ channel: 'email' }), job);
    expect(inbound.messages.markSending).not.toHaveBeenCalled();

    const sms = make();
    await sms.worker.process(queued({ channel: 'sms' }), job);
    expect(sms.messages.markSending).not.toHaveBeenCalled();

    const failed = make();
    await failed.worker.process(queued({ status: 'failed' }), job);
    expect(failed.messages.markSending).not.toHaveBeenCalled();
  });

  it('only re-puts the PSID# pointer when the message already carries a SES id', async () => {
    const { worker, messages, sender } = make();
    await worker.process(queued({ status: 'sent', providerSid: 'ses-old' }), job);
    expect(messages.putProviderSidPointer).toHaveBeenCalledWith('ses-old', job);
    expect(messages.markSending).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('when the claim fails on a fresh message, another worker has it', async () => {
    const { worker, sender } = make({ claim: false });
    await worker.process(queued(), job);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('after a dead attempt, resends only when no SES event has moved the message on', async () => {
    const dead = queued({ status: 'sending', sendingStartedAt: '2026-09-15T10:05:00.500Z' });

    const untouched = make({ message: dead, claim: false, fresh: dead });
    await untouched.worker.process(dead, job);
    expect(untouched.sender.send).toHaveBeenCalledTimes(1);

    const delivered = make({ message: dead, claim: false, fresh: queued({ status: 'delivered', providerSid: 'ses-9' }) });
    await delivered.worker.process(dead, job);
    expect(delivered.sender.send).not.toHaveBeenCalled();

    const gone = make({ message: dead, claim: false, fresh: null });
    await gone.worker.process(dead, job);
    expect(gone.sender.send).not.toHaveBeenCalled();
  });
});
