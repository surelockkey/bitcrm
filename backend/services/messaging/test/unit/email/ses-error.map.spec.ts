import {
  SES_EVENT_STATUS,
  classifySesError,
  describeSesError,
  sesMessageIdFromHeader,
  sesMessageIdHeader,
} from '../../../src/email/ses-error.map';

const sdkError = (name: string, status: number, message = `${name} happened`) =>
  Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });

describe('classifySesError', () => {
  it('retries throttling, 5xx and network failures', () => {
    expect(classifySesError(sdkError('TooManyRequestsException', 429))).toMatchObject({ kind: 'retry' });
    expect(classifySesError(sdkError('LimitExceededException', 400))).toMatchObject({ kind: 'retry' });
    expect(classifySesError(sdkError('InternalFailure', 500))).toMatchObject({ kind: 'retry' });
    expect(classifySesError(new Error('ECONNRESET'))).toMatchObject({ kind: 'retry', reason: 'ECONNRESET' });
    expect(classifySesError(undefined)).toMatchObject({ kind: 'retry' });
  });

  it('fails on stable 4xx reasons with a readable line', () => {
    expect(classifySesError(sdkError('MessageRejected', 400, 'Email address is not verified'))).toEqual({
      kind: 'fail',
      errorCode: 'MessageRejected',
      errorMessage: 'SES rejected the message: Email address is not verified',
    });
    expect(classifySesError(sdkError('MailFromDomainNotVerifiedException', 400))).toMatchObject({ kind: 'fail', errorCode: 'MailFromDomainNotVerifiedException' });
    expect(classifySesError(sdkError('AccountSuspendedException', 400))).toMatchObject({ kind: 'fail' });
    expect(classifySesError({ $metadata: { httpStatusCode: 403 }, message: 'no' })).toEqual({ kind: 'fail', errorCode: '403', errorMessage: 'no' });
  });
});

describe('describeSesError', () => {
  it('combines the known line with the provider detail, or falls back', () => {
    expect(describeSesError('SES_BOUNCE', '550 5.1.1 user unknown')).toBe('The recipient mailbox rejected the message: 550 5.1.1 user unknown');
    expect(describeSesError('SES_BOUNCE')).toBe('The recipient mailbox rejected the message');
    expect(describeSesError('Whatever')).toBe('SES error Whatever');
    expect(describeSesError('Whatever', 'detail')).toBe('detail');
    expect(describeSesError(undefined)).toBeUndefined();
  });
});

describe('SES event → status', () => {
  it('maps the delivery lifecycle and leaves Complaint / DeliveryDelay alone', () => {
    expect(SES_EVENT_STATUS.Send).toBe('sent');
    expect(SES_EVENT_STATUS.Delivery).toBe('delivered');
    expect(SES_EVENT_STATUS.Bounce).toBe('undelivered');
    expect(SES_EVENT_STATUS.Reject).toBe('failed');
    expect(SES_EVENT_STATUS.RenderingFailure).toBe('failed');
    expect(SES_EVENT_STATUS.Open).toBe('opened');
    expect(SES_EVENT_STATUS.Click).toBe('clicked');
    expect(SES_EVENT_STATUS.Complaint).toBeUndefined();
    expect(SES_EVENT_STATUS.DeliveryDelay).toBeUndefined();
  });
});

describe('SES Message-ID', () => {
  it('round-trips the SES message id through the header SES stamps', () => {
    expect(sesMessageIdHeader('0100018-abc', 'us-east-1')).toBe('<0100018-abc@email.amazonses.com>');
    expect(sesMessageIdHeader('0100018-abc', 'eu-west-1')).toBe('<0100018-abc@eu-west-1.amazonses.com>');
    expect(sesMessageIdFromHeader('<0100018-abc@email.amazonses.com>')).toBe('0100018-abc');
    expect(sesMessageIdFromHeader('0100018-abc@eu-west-1.amazonses.com')).toBe('0100018-abc');
    expect(sesMessageIdFromHeader('<xyz@mail.gmail.com>')).toBeUndefined();
    expect(sesMessageIdFromHeader(undefined)).toBeUndefined();
  });
});
