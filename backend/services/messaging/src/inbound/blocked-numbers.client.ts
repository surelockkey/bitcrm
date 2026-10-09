import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { tryNormalizePhone } from '@bitcrm/shared';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../outbound/internal/internal-fetch';

const TELEPHONY_SERVICE_URL = process.env.TELEPHONY_SERVICE_URL || 'http://localhost:4006';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** How long the block list is trusted — the same 60 s as the owned numbers. */
export const BLOCKED_NUMBERS_TTL_MS = 60_000;

/**
 * The numbers the workspace refuses (Workiz Phone → Blocked callers). Telephony
 * owns the list and rejects their calls; this is messaging's cached read of
 * its internal listing, so their texts are dropped too — a bare `fetch` with
 * `x-internal-secret`, like `TelephonyNumbersClient`.
 *
 * Fail-open, deliberately: before the first success, and on an error with
 * nothing cached, nobody is blocked. A telephony outage must never make
 * every inbound text vanish; a spam text getting through meanwhile is the
 * smaller harm. Once a list has been read it is served stale on error.
 */
@Injectable()
export class BlockedNumbersClient {
  private readonly logger = new Logger(BlockedNumbersClient.name);
  private cache: { numbers: Set<string>; expiresAt: number } | null = null;

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  /** Whether an inbound `From` is on the list, in whatever form it was written. */
  async isBlocked(from: string, now: number = Date.now()): Promise<boolean> {
    const canonical = from ? tryNormalizePhone(from) : null;
    if (!canonical) return false;
    return (await this.list(now)).has(canonical);
  }

  async list(now: number = Date.now()): Promise<Set<string>> {
    if (this.cache && this.cache.expiresAt > now) return this.cache.numbers;

    try {
      const res = await this.fetchImpl(`${TELEPHONY_SERVICE_URL}/api/telephony/blocked-callers/internal/numbers`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) {
        this.logger.warn(`blocked-numbers listing returned ${res.status}`);
        return this.cache?.numbers ?? new Set();
      }
      const body = (await res.json()) as { data?: unknown };
      const numbers = new Set(
        (Array.isArray(body.data) ? body.data : []).filter((n): n is string => typeof n === 'string'),
      );
      this.cache = { numbers, expiresAt: now + BLOCKED_NUMBERS_TTL_MS };
      return numbers;
    } catch (error) {
      this.logger.warn(`blocked-numbers listing failed: ${error instanceof Error ? error.message : error}`);
      return this.cache?.numbers ?? new Set();
    }
  }

  /** Drop the cache. */
  forget(): void {
    this.cache = null;
  }
}
