import { HttpException } from '@nestjs/common';
import twilio, { type Twilio } from 'twilio';
import { type TelephonyConfig } from '../telephony/telephony.config';

/**
 * Shared Twilio REST access: one lazily-built client per config, plus the
 * error-translation wrapper every REST call goes through so the real,
 * human-readable Twilio reason (e.g. "Trial accounts are allowed only one
 * Twilio number") reaches the API client instead of a generic 500.
 */
export class TwilioRest {
  private _client: Twilio | null = null;

  constructor(private readonly config: TelephonyConfig) {}

  get client(): Twilio {
    if (!this._client) {
      this._client = twilio(this.config.accountSid, this.config.authToken);
    }
    return this._client;
  }

  async run<T>(fn: (client: Twilio) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      const status =
        typeof err.status === 'number' && err.status >= 400 && err.status < 600
          ? err.status
          : 502; // upstream failure with no usable status
      throw new HttpException(err.message ?? 'Twilio request failed', status);
    }
  }
}
