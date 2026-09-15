import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import twilio from 'twilio';
import {
  TwilioSignatureGuard,
  isValidTwilioRequest,
  type TwilioSignedRequest,
} from '../../../src/twilio/twilio-signature.guard';

const AUTH_TOKEN = 'the-auth-token';
const PUBLIC_BASE_URL = 'https://api.example.test';

const options = (over: { validateSignature?: boolean } = {}) => ({
  authToken: AUTH_TOKEN,
  publicBaseUrl: PUBLIC_BASE_URL,
  validateSignature: over.validateSignature ?? true,
});

/** A request as Express hands it to a guard behind nginx. */
function signedRequest(
  path: string,
  body: Record<string, string>,
  over: { signature?: string; token?: string } = {},
): TwilioSignedRequest {
  // Twilio signs the PUBLIC url — what nginx received, not what the service sees.
  const signature =
    over.signature ??
    twilio.getExpectedTwilioSignature(
      over.token ?? AUTH_TOKEN,
      `${PUBLIC_BASE_URL}${path}`,
      body,
    );
  return {
    headers: { 'x-twilio-signature': signature },
    originalUrl: path,
    url: path.replace(/^\/api\/telephony/, ''), // the mounted router's view
    body,
  };
}

const contextFor = (req: TwilioSignedRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  }) as unknown as ExecutionContext;

describe('isValidTwilioRequest', () => {
  const body = { CallSid: 'CA1', From: '+15550001111' };

  it('accepts a request Twilio signed for the public URL', () => {
    const req = signedRequest('/api/telephony/voice/inbound', body);
    expect(isValidTwilioRequest(options(), req)).toBe(true);
  });

  it('covers the query string, so routing params cannot be tampered with', () => {
    const req = signedRequest('/api/telephony/voice/status?conf=abc&role=agent', body);
    expect(isValidTwilioRequest(options(), req)).toBe(true);

    req.originalUrl = '/api/telephony/voice/status?conf=abc&role=customer';
    expect(isValidTwilioRequest(options(), req)).toBe(false);
  });

  it('rejects a signature made with another account token', () => {
    const req = signedRequest('/api/telephony/voice/inbound', body, {
      token: 'somebody-elses-token',
    });
    expect(isValidTwilioRequest(options(), req)).toBe(false);
  });

  it('rejects a missing header without throwing', () => {
    const req = signedRequest('/api/telephony/voice/inbound', body);
    req.headers = {};
    expect(isValidTwilioRequest(options(), req)).toBe(false);
  });

  it('takes the first value when the header arrives as a list', () => {
    const req = signedRequest('/api/telephony/voice/inbound', body);
    req.headers = { 'x-twilio-signature': [req.headers['x-twilio-signature'] as string] };
    expect(isValidTwilioRequest(options(), req)).toBe(true);
  });

  it('treats a missing body as no params (GET webhooks)', () => {
    const req = signedRequest('/api/telephony/voice/hold', {});
    delete req.body;
    expect(isValidTwilioRequest(options(), req)).toBe(true);
  });
});

describe('TwilioSignatureGuard', () => {
  const body = { MessageSid: 'SM1', From: '+15550001111', Body: 'hi' };

  it('lets a correctly signed webhook through', () => {
    const guard = new TwilioSignatureGuard(options());
    const req = signedRequest('/api/messaging/webhooks/twilio/inbound', body);
    expect(guard.canActivate(contextFor(req))).toBe(true);
  });

  it('rejects a forged signature with 403', () => {
    const guard = new TwilioSignatureGuard(options());
    const req = signedRequest('/api/messaging/webhooks/twilio/inbound', body, {
      signature: 'bm90IGEgcmVhbCBzaWduYXR1cmU=',
    });
    expect(() => guard.canActivate(contextFor(req))).toThrow(ForbiddenException);
  });

  it('is a no-op when validation is switched off (local curl testing)', () => {
    const guard = new TwilioSignatureGuard(options({ validateSignature: false }));
    const req = signedRequest('/api/messaging/webhooks/twilio/inbound', body, {
      signature: 'garbage',
    });
    expect(guard.canActivate(contextFor(req))).toBe(true);
  });

  it('validates against the public URL, not the path the service sees', () => {
    const guard = new TwilioSignatureGuard(options());
    const req = signedRequest('/api/telephony/voice/inbound', body);
    // Strip the public prefix from what the guard is told the original url
    // was: the signature no longer matches, because Twilio signed the full one.
    req.originalUrl = req.url;
    expect(() => guard.canActivate(contextFor(req))).toThrow(ForbiddenException);
  });
});
