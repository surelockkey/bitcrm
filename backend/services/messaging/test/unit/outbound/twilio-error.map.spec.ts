import {
  TWILIO_ERROR_MESSAGES,
  classifyTwilioError,
  describeTwilioError,
  mapTwilioStatus,
} from '../../../src/outbound/twilio-error.map';

describe('classifyTwilioError', () => {
  it('21610 fails the message and flips the STOP list', () => {
    expect(classifyTwilioError({ status: 400, code: 21610, message: 'Attempt to send to unsubscribed recipient' })).toEqual({
      kind: 'fail',
      errorCode: '21610',
      errorMessage: 'Attempt to send to unsubscribed recipient',
      optOut: true,
    });
  });

  it('invalid / non-mobile / region / unregistered numbers fail without retry', () => {
    for (const code of [21211, 21614, 21408, 21606, 30034, 30032]) {
      const action = classifyTwilioError({ status: 400, code, message: `err ${code}` });
      expect(action).toMatchObject({ kind: 'fail', errorCode: String(code), optOut: false });
    }
    expect(classifyTwilioError({ status: 404, code: 20404, message: 'not found' })).toMatchObject({ kind: 'fail', errorCode: '20404' });
  });

  it('rate limits, 5xx and network failures are retried', () => {
    expect(classifyTwilioError({ status: 429, code: 20429, message: 'Too many requests' })).toMatchObject({ kind: 'retry' });
    expect(classifyTwilioError({ status: 429, message: 'throttled' })).toMatchObject({ kind: 'retry' });
    expect(classifyTwilioError({ status: 503, code: 20503, message: 'Service unavailable' })).toMatchObject({ kind: 'retry' });
    expect(classifyTwilioError(new Error('ECONNRESET'))).toMatchObject({ kind: 'retry', reason: 'ECONNRESET' });
    expect(classifyTwilioError(undefined)).toMatchObject({ kind: 'retry' });
  });

  it('falls back to the HTTP status as the code for a bare 4xx', () => {
    expect(classifyTwilioError({ status: 400, message: 'Bad request' })).toEqual({
      kind: 'fail',
      errorCode: '400',
      errorMessage: 'Bad request',
      optOut: false,
    });
  });
});

describe('describeTwilioError', () => {
  it("prefers Twilio's message, then our table, then a generic line", () => {
    expect(describeTwilioError('30007', 'Carrier violation')).toBe('Carrier violation');
    expect(describeTwilioError('30007')).toBe(TWILIO_ERROR_MESSAGES['30007']);
    expect(describeTwilioError('30007', null)).toBe(TWILIO_ERROR_MESSAGES['30007']);
    expect(describeTwilioError('99999')).toBe('Twilio error 99999');
    expect(describeTwilioError(undefined)).toBeUndefined();
  });

  it('covers the codes the design calls out', () => {
    for (const code of ['21211', '21408', '21610', '21614', '30003', '30005', '30006', '30007', '30032', '30034']) {
      expect(TWILIO_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});

describe('mapTwilioStatus', () => {
  it('maps every callback and create-response status onto ours', () => {
    expect(mapTwilioStatus('queued')).toBe('queued');
    expect(mapTwilioStatus('accepted')).toBe('queued');
    expect(mapTwilioStatus('scheduled')).toBe('queued');
    expect(mapTwilioStatus('sending')).toBe('sending');
    expect(mapTwilioStatus('sent')).toBe('sent');
    expect(mapTwilioStatus('delivered')).toBe('delivered');
    expect(mapTwilioStatus('partially_delivered')).toBe('delivered');
    expect(mapTwilioStatus('undelivered')).toBe('undelivered');
    expect(mapTwilioStatus('failed')).toBe('failed');
    expect(mapTwilioStatus('canceled')).toBe('canceled');
    expect(mapTwilioStatus('read')).toBe('read');
    expect(mapTwilioStatus('DELIVERED')).toBe('delivered');
  });

  it('ignores what it does not know', () => {
    expect(mapTwilioStatus('receiving')).toBeUndefined();
    expect(mapTwilioStatus(undefined)).toBeUndefined();
    expect(mapTwilioStatus('')).toBeUndefined();
  });
});
