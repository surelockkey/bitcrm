import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from './internal-fetch';

const TELEPHONY_SERVICE_URL = process.env.TELEPHONY_SERVICE_URL || 'http://localhost:4006';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** How long the owned-number set is trusted (design §4.2: 60 s). */
export const OWNED_NUMBERS_TTL_MS = 60_000;

/** One row of telephony's `GET /numbers/internal/owned`. */
export interface OwnedNumberInfo {
  phoneNumber: string;
  sid: string;
  friendlyName?: string;
  capabilities: { sms: boolean; mms: boolean; voice: boolean };
  /** `MG…` the number is pooled in; absent when telephony could not tell. */
  messagingServiceSid?: string;
  /** Job source the number is tracked as (`NUMSET#ALL`), when assigned. */
  sourceId?: string;
}

/**
 * The numbers the workspace owns, with what the sender chain needs to know
 * about each (SMS capability, Messaging Service membership, job source).
 * Telephony stays the owner of the numbers (design §2.2); this is a cached,
 * best-effort read of its internal listing — a bare `fetch` with
 * `x-internal-secret`, the same shape as telephony's own
 * `ServiceAreaNumbersService`. A stale list beats no list: on failure the
 * previous answer is served, and before the first success the list is
 * empty, which the resolver reads as "unknown", not "we own nothing".
 */
@Injectable()
export class TelephonyNumbersClient {
  private readonly logger = new Logger(TelephonyNumbersClient.name);
  private cache: { numbers: OwnedNumberInfo[]; expiresAt: number } | null = null;

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async listOwned(now: number = Date.now()): Promise<OwnedNumberInfo[]> {
    if (this.cache && this.cache.expiresAt > now) return this.cache.numbers;

    try {
      const res = await this.fetchImpl(`${TELEPHONY_SERVICE_URL}/api/telephony/numbers/internal/owned`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) {
        this.logger.warn(`owned-numbers listing returned ${res.status}`);
        return this.cache?.numbers ?? [];
      }
      const body = (await res.json()) as { data?: OwnedNumberInfo[] };
      const numbers = (body.data ?? []).filter((n) => typeof n.phoneNumber === 'string');
      this.cache = { numbers, expiresAt: now + OWNED_NUMBERS_TTL_MS };
      return numbers;
    } catch (error) {
      this.logger.warn(
        `owned-numbers listing failed: ${error instanceof Error ? error.message : error}`,
      );
      return this.cache?.numbers ?? [];
    }
  }

  /** Drop the cache — after a number is bought or released, for instance. */
  forget(): void {
    this.cache = null;
  }
}
