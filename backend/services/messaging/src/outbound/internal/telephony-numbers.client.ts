import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from './internal-fetch';

const TELEPHONY_SERVICE_URL = process.env.TELEPHONY_SERVICE_URL || 'http://localhost:4006';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/**
 * How long the owned-number set is served without asking again. Telephony
 * caches Twilio's listing itself now, so this only saves the hop; a number
 * bought or released shows within it (or at once on this task: `forget()`).
 */
export const OWNED_NUMBERS_TTL_MS = 5 * 60_000;
/**
 * Older than the TTL but younger than this: served at once while one
 * background refresh replaces it. Older still: the read waits for the
 * refresh (and still gets this list if the refresh fails).
 */
export const OWNED_NUMBERS_STALE_MS = 30 * 60_000;

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
  /** The last good answer and when it was fetched. A failure never touches it. */
  private cache: { numbers: OwnedNumberInfo[]; at: number } | null = null;
  /** The fetch in progress — one at a time per process. */
  private inflight: Promise<OwnedNumberInfo[] | null> | null = null;
  /** Bumped by `forget()`: a fetch started before it may not write. */
  private generation = 0;

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  /**
   * Fresh (< `OWNED_NUMBERS_TTL_MS`): the cached list. Stale (<
   * `OWNED_NUMBERS_STALE_MS`): the cached list now, refreshed in the
   * background. Older, or nothing yet: the fetch is waited for — falling
   * back to whatever was cached, or `[]` ("unknown") before the first success.
   */
  async listOwned(now: number = Date.now()): Promise<OwnedNumberInfo[]> {
    const age = this.cache ? now - this.cache.at : Infinity;
    if (this.cache && age < OWNED_NUMBERS_TTL_MS) return this.cache.numbers;

    if (this.cache && age < OWNED_NUMBERS_STALE_MS) {
      void this.refresh(now);
      return this.cache.numbers;
    }

    const fresh = await this.refresh(now);
    return fresh ?? this.cache?.numbers ?? [];
  }

  /** Drop the cache — after a number is bought or released, for instance. */
  forget(): void {
    this.cache = null;
    this.inflight = null;
    this.generation += 1;
  }

  /** One fetch at a time; resolves `null` on any failure (logged), never rejects. */
  private refresh(now: number): Promise<OwnedNumberInfo[] | null> {
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    const flight = this.fetchOwned().then((numbers) => {
      if (numbers && generation === this.generation) this.cache = { numbers, at: now };
      return numbers;
    });
    this.inflight = flight;
    const clear = () => {
      if (this.inflight === flight) this.inflight = null;
    };
    flight.then(clear, clear);
    return flight;
  }

  private async fetchOwned(): Promise<OwnedNumberInfo[] | null> {
    try {
      const res = await this.fetchImpl(`${TELEPHONY_SERVICE_URL}/api/telephony/numbers/internal/owned`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) {
        this.logger.warn(`owned-numbers listing returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { data?: OwnedNumberInfo[] };
      return (body.data ?? []).filter((n) => typeof n.phoneNumber === 'string');
    } catch (error) {
      this.logger.warn(
        `owned-numbers listing failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
