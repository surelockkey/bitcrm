import { StatusCallbackService, type TwilioStatusBody } from '../../../src/outbound/status-callback.service';
import { T1 } from '../mocks';

const query = { c: 'c1', t: T1, m: 'm2' };
const key = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };

function makeService(opts: { applied?: boolean; pointer?: { conversationId: string; messageSk: string } | null; accountSid?: string } = {}) {
  const messages = {
    updateStatus: jest.fn(async () => opts.applied ?? true),
    getProviderSidPointer: jest.fn(async () => opts.pointer ?? null),
  };
  const optOuts = { setStatus: jest.fn(async () => ({})) };
  const events = {
    statusChanged: jest.fn(async () => undefined),
    conversationUpdated: jest.fn(async () => undefined),
    optOutChanged: jest.fn(async () => undefined),
  };
  const service = new StatusCallbackService(messages as any, optOuts as any, events as any, {
    accountSid: opts.accountSid ?? 'AC1',
    messagingServiceSid: 'MG1',
  });
  return { service, messages, optOuts, events };
}

const body = (overrides: Partial<TwilioStatusBody> = {}): TwilioStatusBody => ({
  MessageSid: 'SM2',
  MessageStatus: 'delivered',
  AccountSid: 'AC1',
  From: '+15550001111',
  To: '+14045551234',
  ...overrides,
});

describe('StatusCallbackService', () => {
  it('applies a status from the signed query key with the sid guard and publishes on a terminal one', async () => {
    const { service, messages, events } = makeService();
    expect(await service.handle(query, body())).toBe('applied');
    expect(messages.updateStatus).toHaveBeenCalledWith(key, { status: 'delivered', providerSid: 'SM2', errorCode: undefined, errorMessage: undefined });
    expect(messages.getProviderSidPointer).not.toHaveBeenCalled();
    expect(events.statusChanged).toHaveBeenCalledWith(key, 'delivered', undefined);
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('does not publish status_changed for a non-terminal step', async () => {
    const { service, events } = makeService();
    expect(await service.handle(query, body({ MessageStatus: 'sent' }))).toBe('applied');
    expect(events.statusChanged).not.toHaveBeenCalled();
    expect(events.conversationUpdated).toHaveBeenCalled();
  });

  it('is idempotent: a repeated or out-of-order callback is ignored by the rank guard', async () => {
    const { service, events } = makeService({ applied: false });
    expect(await service.handle(query, body({ MessageStatus: 'sent' }))).toBe('ignored');
    expect(events.statusChanged).not.toHaveBeenCalled();
    expect(events.conversationUpdated).not.toHaveBeenCalled();
  });

  it('records the error code with a readable message on undelivered / failed', async () => {
    const { service, messages } = makeService();
    await service.handle(query, body({ MessageStatus: 'undelivered', ErrorCode: '30007' }));
    expect(messages.updateStatus).toHaveBeenCalledWith(key, {
      status: 'undelivered',
      providerSid: 'SM2',
      errorCode: '30007',
      errorMessage: 'The message was filtered by the carrier (flagged as spam)',
    });
    await service.handle(query, body({ MessageStatus: 'failed', ErrorCode: '0' }));
    expect(messages.updateStatus).toHaveBeenLastCalledWith(key, expect.objectContaining({ errorCode: undefined }));
  });

  it('21610 puts the recipient on the STOP list', async () => {
    const { service, optOuts, events } = makeService();
    await service.handle(query, body({ MessageStatus: 'failed', ErrorCode: '21610' }));
    expect(optOuts.setStatus).toHaveBeenCalledWith({ channel: 'sms', address: '+14045551234', status: 'opted_out', source: 'error_21610', messagingServiceSid: 'MG1' });
    expect(events.optOutChanged).toHaveBeenCalledWith({ channel: 'sms', address: '+14045551234', status: 'opted_out', source: 'error_21610' });
    expect(events.statusChanged).toHaveBeenCalledWith(key, 'failed', '21610');
  });

  it('falls back to the PSID# pointer when the query carries no key', async () => {
    const { service, messages } = makeService({ pointer: { conversationId: 'c1', messageSk: `MSG#${T1}#m2` } });
    expect(await service.handle({}, body())).toBe('applied');
    expect(messages.getProviderSidPointer).toHaveBeenCalledWith('SM2');
    expect(messages.updateStatus).toHaveBeenCalledWith(key, expect.objectContaining({ status: 'delivered' }));

    const unknown = makeService({ pointer: null });
    expect(await unknown.service.handle({ c: 'c1' }, body())).toBe('unknown');
    expect(unknown.messages.updateStatus).not.toHaveBeenCalled();
  });

  it('accepts the legacy SmsSid / SmsStatus names and ignores an unusable payload', async () => {
    const { service, messages } = makeService();
    expect(await service.handle(query, { SmsSid: 'SM2', SmsStatus: 'sent', AccountSid: 'AC1' })).toBe('applied');
    expect(messages.updateStatus).toHaveBeenCalledWith(key, expect.objectContaining({ status: 'sent', providerSid: 'SM2' }));
    expect(await service.handle(query, { MessageSid: 'SM2', MessageStatus: 'receiving' })).toBe('ignored');
    expect(await service.handle(query, {})).toBe('ignored');
  });

  it("refuses a callback from another Twilio account", async () => {
    const { service, messages } = makeService();
    await expect(service.handle(query, body({ AccountSid: 'ACother' }))).rejects.toMatchObject({ status: 403 });
    expect(messages.updateStatus).not.toHaveBeenCalled();
    // …but not one that simply omits AccountSid, nor when no account is configured
    expect(await service.handle(query, body({ AccountSid: undefined }))).toBe('applied');
    expect(await makeService({ accountSid: '' }).service.handle(query, body({ AccountSid: 'ACother' }))).toBe('applied');
  });
});
