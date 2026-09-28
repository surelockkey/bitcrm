import { ServiceUnavailableException } from '@nestjs/common';
import { TwilioVerifyClient } from '../../../src/mfa/twilio-verify.client';

/**
 * Twilio Verify generates, texts and checks the sign-in code; we never hold
 * the code ourselves. Two calls: start a verification, check a code.
 */
const CONFIG = { accountSid: 'AC123', authToken: 'secret', serviceSid: 'VA456' };

function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function make(answer: () => Response | Promise<Response>, config = CONFIG) {
  const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => answer());
  return { client: new TwilioVerifyClient(config, fetchImpl), fetchImpl };
}

describe('TwilioVerifyClient.send', () => {
  it('starts an SMS verification on the service, authenticated as the account', async () => {
    const { client, fetchImpl } = make(() => reply(201, { status: 'pending' }));

    await client.send('+14045551234');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA456/Verifications');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
    );
    expect(String(init?.body)).toBe(new URLSearchParams({ To: '+14045551234', Channel: 'sms' }).toString());
  });

  it('turns a Twilio refusal into a 503 the sign-in can report', async () => {
    const { client } = make(() => reply(429, { message: 'Max send attempts reached' }));

    await expect(client.send('+14045551234')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses to run unconfigured rather than pretend a code went out', async () => {
    const { client, fetchImpl } = make(() => reply(201, {}), { ...CONFIG, serviceSid: '' });

    await expect(client.send('+14045551234')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('TwilioVerifyClient.check', () => {
  it('is true only when Twilio approves the code', async () => {
    const { client, fetchImpl } = make(() => reply(200, { status: 'approved' }));

    await expect(client.check('+14045551234', '123456')).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://verify.twilio.com/v2/Services/VA456/VerificationCheck');
    expect(String(init?.body)).toBe(new URLSearchParams({ To: '+14045551234', Code: '123456' }).toString());
  });

  it('is false for a wrong code', async () => {
    const { client } = make(() => reply(200, { status: 'pending' }));

    await expect(client.check('+14045551234', '000000')).resolves.toBe(false);
  });

  // Twilio answers 404 once a verification is approved, expired or used up.
  it('is false when the verification no longer exists', async () => {
    const { client } = make(() => reply(404, { code: 20404 }));

    await expect(client.check('+14045551234', '123456')).resolves.toBe(false);
  });

  it('throws a 503 when Twilio cannot answer at all', async () => {
    const { client } = make(() => {
      throw new Error('ECONNRESET');
    });

    await expect(client.check('+14045551234', '123456')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
