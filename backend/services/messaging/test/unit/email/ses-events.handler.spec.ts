import { SesEventsHandler, type SesEvent } from '../../../src/email/ses-events.handler';
import { createMockMessage, T1 } from '../mocks';

const key = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };
const tags = { 'bitcrm-conversation': ['c1'], 'bitcrm-message': ['m2'], 'bitcrm-created': [String(Date.parse(T1))] };

function make(opts: { applied?: boolean; pointer?: { conversationId: string; messageSk: string } | null } = {}) {
  const messages = {
    updateStatus: jest.fn(async () => opts.applied ?? true),
    getProviderSidPointer: jest.fn(async () => opts.pointer ?? null),
    get: jest.fn(async () => createMockMessage({ id: 'm2', channel: 'email', direction: 'outbound', status: 'delivered' })),
  };
  const optOuts = { setStatus: jest.fn(async () => ({})) };
  const events = {
    statusChanged: jest.fn(async () => undefined),
    conversationUpdated: jest.fn(async () => undefined),
    optOutChanged: jest.fn(async () => undefined),
  };
  const realtime = { messageUpserted: jest.fn(), optOutChanged: jest.fn() };
  const metrics = { sqsMessagesProcessed: { inc: jest.fn() } };
  const handler = new SesEventsHandler(messages as any, optOuts as any, events as any, realtime as any, metrics as any);
  return { handler, messages, optOuts, events, realtime, metrics };
}

const event = (type: string, over: Partial<SesEvent> = {}): SesEvent => ({
  eventType: type,
  mail: { messageId: 'ses-1', timestamp: '2026-09-15T10:05:01.000Z', destination: ['jane@example.com'], tags },
  ...over,
});

describe('SesEventsHandler.apply', () => {
  it('Delivery → delivered from the tags, with the sid guard, publishing the terminal status and the read-back message', async () => {
    const { handler, messages, events, realtime } = make();
    expect(await handler.apply(event('Delivery', { delivery: { timestamp: '2026-09-15T10:05:03.000Z' } }))).toBe('applied');
    expect(messages.getProviderSidPointer).not.toHaveBeenCalled();
    expect(messages.updateStatus).toHaveBeenCalledWith(key, {
      status: 'delivered',
      providerSid: 'ses-1',
      errorCode: undefined,
      errorMessage: undefined,
      sentAt: undefined,
      deliveredAt: '2026-09-15T10:05:03.000Z',
    });
    expect(events.statusChanged).toHaveBeenCalledWith(key, 'delivered', undefined);
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
    expect(realtime.messageUpserted).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2', status: 'delivered' }));
  });

  it('Send → sent with SES’s timestamp; Open / Click walk the rank', async () => {
    const { handler, messages, events } = make();
    await handler.apply(event('Send'));
    expect(messages.updateStatus).toHaveBeenLastCalledWith(key, expect.objectContaining({ status: 'sent', sentAt: '2026-09-15T10:05:01.000Z' }));
    await handler.apply(event('Open', { open: { timestamp: 'x' } }));
    expect(messages.updateStatus).toHaveBeenLastCalledWith(key, expect.objectContaining({ status: 'opened' }));
    await handler.apply(event('Click', { click: { link: 'https://x' } }));
    expect(messages.updateStatus).toHaveBeenLastCalledWith(key, expect.objectContaining({ status: 'clicked' }));
    expect(events.statusChanged).not.toHaveBeenCalled();
  });

  it('a permanent Bounce is undelivered and puts every bounced address on the email STOP list', async () => {
    const { handler, messages, optOuts, events, realtime } = make();
    const bounce = event('Bounce', {
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress: 'Jane@Example.com', diagnosticCode: 'smtp; 550 5.1.1 user unknown' }],
      },
    });
    expect(await handler.apply(bounce)).toBe('applied');
    expect(messages.updateStatus).toHaveBeenCalledWith(key, expect.objectContaining({
      status: 'undelivered',
      errorCode: 'SES_BOUNCE',
      errorMessage: 'The recipient mailbox rejected the message: smtp; 550 5.1.1 user unknown',
    }));
    expect(optOuts.setStatus).toHaveBeenCalledWith({ channel: 'email', address: 'jane@example.com', status: 'opted_out', source: 'ses_bounce' });
    expect(events.optOutChanged).toHaveBeenCalledWith({ channel: 'email', address: 'jane@example.com', status: 'opted_out', source: 'ses_bounce' });
    expect(realtime.optOutChanged).toHaveBeenCalledWith({ channel: 'email', address: 'jane@example.com', status: 'opted_out', conversationId: 'c1' });
    expect(events.statusChanged).toHaveBeenCalledWith(key, 'undelivered', 'SES_BOUNCE');
  });

  it('a transient Bounce is undelivered without an opt-out', async () => {
    const { handler, messages, optOuts } = make();
    await handler.apply(event('Bounce', { bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', bouncedRecipients: [{ emailAddress: 'jane@example.com' }] } }));
    expect(messages.updateStatus).toHaveBeenCalledWith(key, expect.objectContaining({ status: 'undelivered', errorCode: 'SES_BOUNCE_TRANSIENT', errorMessage: 'The recipient mailbox is temporarily unavailable: MailboxFull' }));
    expect(optOuts.setStatus).not.toHaveBeenCalled();
  });

  it('a Complaint changes no status but opts the complainer out', async () => {
    const { handler, messages, optOuts, events } = make();
    expect(await handler.apply(event('Complaint', { complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'jane@example.com' }] } }))).toBe('applied');
    expect(messages.updateStatus).not.toHaveBeenCalled();
    expect(optOuts.setStatus).toHaveBeenCalledWith(expect.objectContaining({ address: 'jane@example.com', source: 'ses_complaint' }));
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('Reject and RenderingFailure are failed with their reason', async () => {
    const { handler, messages } = make();
    await handler.apply(event('Reject', { reject: { reason: 'Bad content' } }));
    expect(messages.updateStatus).toHaveBeenLastCalledWith(key, expect.objectContaining({ status: 'failed', errorCode: 'SES_REJECT', errorMessage: 'SES rejected the message (virus detected): Bad content' }));
    await handler.apply(event('RenderingFailure', { failure: { errorMessage: 'template broke' } }));
    expect(messages.updateStatus).toHaveBeenLastCalledWith(key, expect.objectContaining({ status: 'failed', errorCode: 'SES_RENDERING_FAILURE' }));
  });

  it('is idempotent: a repeated or out-of-order event is ignored by the rank guard', async () => {
    const { handler, events, realtime } = make({ applied: false });
    expect(await handler.apply(event('Send'))).toBe('ignored');
    expect(events.statusChanged).not.toHaveBeenCalled();
    expect(events.conversationUpdated).not.toHaveBeenCalled();
    expect(realtime.messageUpserted).not.toHaveBeenCalled();
  });

  it('falls back to PSID# without tags, and drops what is neither', async () => {
    const found = make({ pointer: { conversationId: 'c1', messageSk: `MSG#${T1}#m2` } });
    expect(await found.handler.apply(event('Delivery', { mail: { messageId: 'ses-1' } }))).toBe('applied');
    expect(found.messages.getProviderSidPointer).toHaveBeenCalledWith('ses-1');
    expect(found.messages.updateStatus).toHaveBeenCalledWith(key, expect.objectContaining({ status: 'delivered' }));

    const foreign = make({ pointer: null });
    expect(await foreign.handler.apply(event('Delivery', { mail: { messageId: 'ses-x' } }))).toBe('unknown');
    expect(foreign.messages.updateStatus).not.toHaveBeenCalled();
  });

  it('DeliveryDelay and Subscription record nothing; a malformed event is dropped', async () => {
    const { handler, messages } = make();
    expect(await handler.apply(event('DeliveryDelay'))).toBe('ignored');
    expect(await handler.apply(event('Subscription'))).toBe('ignored');
    expect(await handler.apply({ mail: { messageId: 'x' } })).toBe('dropped');
    expect(await handler.apply({ eventType: 'Delivery' })).toBe('dropped');
    expect(messages.updateStatus).not.toHaveBeenCalled();
  });

  it('accepts the older notificationType shape', async () => {
    const { handler, messages } = make();
    await handler.apply({ notificationType: 'Delivery', mail: { messageId: 'ses-1', tags }, delivery: {} });
    expect(messages.updateStatus).toHaveBeenCalledWith(key, expect.objectContaining({ status: 'delivered' }));
  });
});

describe('SesEventsHandler.handle (the SQS body)', () => {
  it('unwraps a raw SNS delivery and a Notification envelope alike, counting the outcome', async () => {
    const { handler, messages, metrics } = make();
    expect(await handler.handle(JSON.stringify(event('Delivery')))).toBe('applied');
    expect(await handler.handle(JSON.stringify({ Type: 'Notification', Message: JSON.stringify(event('Send')) }))).toBe('applied');
    expect(messages.updateStatus).toHaveBeenCalledTimes(2);
    expect(await handler.handle('not json')).toBe('dropped');
    expect(metrics.sqsMessagesProcessed.inc).toHaveBeenCalledWith({ event_type: 'ses.event', status: 'applied' });
  });

  it('lets a storage failure propagate so SQS redelivers', async () => {
    const { handler, messages } = make();
    messages.updateStatus.mockRejectedValueOnce(new Error('dynamo down'));
    await expect(handler.handle(JSON.stringify(event('Delivery')))).rejects.toThrow('dynamo down');
  });
});
