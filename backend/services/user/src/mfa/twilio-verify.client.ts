import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';

export const TWILIO_VERIFY_CONFIG = Symbol('TWILIO_VERIFY_CONFIG');
export const TWILIO_VERIFY_FETCH = Symbol('TWILIO_VERIFY_FETCH');

export interface TwilioVerifyConfig {
  accountSid: string;
  authToken: string;
  /** The Verify Service (VA…) the sign-in codes are sent from. */
  serviceSid: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Read from the environment the deploy fills: the account telephony and messaging already use. */
export function twilioVerifyConfigFromEnv(): TwilioVerifyConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
  };
}

const TIMEOUT_MS = 10_000;

/**
 * Twilio Verify, for the two-step sign-in code. Twilio generates the code,
 * texts it and checks it — we never see or store it — and Verify traffic
 * needs no A2P campaign of ours. Two calls: `send` starts a verification to a
 * number, `check` asks whether a code approves it.
 *
 * Anything Twilio cannot do is a 503, never a silent pass: a sign-in that
 * could not text its code must not look like one that did.
 */
@Injectable()
export class TwilioVerifyClient {
  private readonly logger = new Logger(TwilioVerifyClient.name);

  constructor(
    @Inject(TWILIO_VERIFY_CONFIG) private readonly config: TwilioVerifyConfig,
    @Optional() @Inject(TWILIO_VERIFY_FETCH) private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  async send(phone: string): Promise<void> {
    const res = await this.post('Verifications', { To: phone, Channel: 'sms' }, 'send');
    if (!res.ok) {
      this.logger.warn(`Verify send returned ${res.status}: ${await this.reason(res)}`);
      throw new ServiceUnavailableException('Could not text the sign-in code. Try again in a minute.');
    }
  }

  async check(phone: string, code: string): Promise<boolean> {
    const res = await this.post('VerificationCheck', { To: phone, Code: code }, 'check');
    // 404: approved already, expired, or out of attempts — in every case not this code.
    if (res.status === 404) return false;
    if (!res.ok) {
      this.logger.warn(`Verify check returned ${res.status}: ${await this.reason(res)}`);
      throw new ServiceUnavailableException('Could not check the sign-in code. Try again in a minute.');
    }
    const body = (await res.json()) as { status?: string };
    return body.status === 'approved';
  }

  private async post(path: string, form: Record<string, string>, what: string): Promise<Response> {
    const { accountSid, authToken, serviceSid } = this.config;
    if (!accountSid || !authToken || !serviceSid) {
      this.logger.error('Twilio Verify is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID)');
      throw new ServiceUnavailableException('Two-step sign-in is not available right now.');
    }
    try {
      return await this.fetchImpl(`https://verify.twilio.com/v2/Services/${serviceSid}/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Verify ${what} failed: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException('Could not reach the SMS provider. Try again in a minute.');
    }
  }

  private async reason(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string; code?: number };
      return `${body.code ?? ''} ${body.message ?? ''}`.trim();
    } catch {
      return 'no body';
    }
  }
}
