import { HttpException } from '@nestjs/common';
import twilio, { type Twilio } from 'twilio';

/** What it takes to open a Twilio REST client — any `TwilioConfig` qualifies. */
export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

/** Builds the SDK client; overridable so tests can hand in a fake. */
export type TwilioClientFactory = (
  accountSid: string,
  authToken: string,
) => Twilio;

const defaultClientFactory: TwilioClientFactory = (accountSid, authToken) =>
  twilio(accountSid, authToken);

/**
 * Translate whatever the SDK threw into the HTTP error the API client should
 * see. Twilio's REST errors carry the upstream status (400 for a bad request,
 * 404 for an unknown sid, 429 when throttled…); anything else — a network
 * failure, a timeout — becomes a 502 so it reads as "upstream", not "us".
 */
export function toTwilioHttpException(e: unknown): HttpException {
  const err = (e ?? {}) as { status?: number; message?: string };
  const status =
    typeof err.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : 502; // upstream failure with no usable status
  return new HttpException(err.message ?? 'Twilio request failed', status);
}

/**
 * Shared Twilio REST access: one lazily-built client per config, plus the
 * error-translation wrapper every REST call goes through so the real,
 * human-readable Twilio reason (e.g. "Trial accounts are allowed only one
 * Twilio number") reaches the API client instead of a generic 500.
 */
export class TwilioRest {
  private _client: Twilio | null = null;

  constructor(
    private readonly credentials: TwilioCredentials,
    private readonly createClient: TwilioClientFactory = defaultClientFactory,
  ) {}

  get client(): Twilio {
    if (!this._client) {
      this._client = this.createClient(
        this.credentials.accountSid,
        this.credentials.authToken,
      );
    }
    return this._client;
  }

  async run<T>(fn: (client: Twilio) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (e) {
      throw toTwilioHttpException(e);
    }
  }
}
