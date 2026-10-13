import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type EnrichedCall } from './party-resolver';

/** The Redis list behind the dashboard's "Recent Calls". */
export const RECENT_CALLS_KEY = 'telephony:calls:recent:v1';
/** How many finished calls the list keeps. The widget shows four. */
export const RECENT_CALLS_KEEP = 20;

/**
 * The last finished calls, already named, in one Redis list shared by every
 * task — `GET /calls/stats/recent` used to read a 100-row page of the log and
 * name it on every dashboard load to show four.
 *
 * Pushed by CallFinalizer when a call ends (LPUSH + LTRIM in one MULTI).
 * Stored unmasked; the route masks per viewer. Names are the ones resolved
 * when the call ended — fine for a glance-at widget. A task that pushes the
 * same call twice is harmless: `read` keeps the first of each sid.
 *
 * Redis down → push does nothing and read returns [] (the route then falls
 * back to the log).
 */
@Injectable()
export class RecentCallsStore {
  private readonly logger = new Logger(RecentCallsStore.name);

  constructor(@Optional() private readonly redis?: RedisService) {}

  async push(call: EnrichedCall): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.client
        .multi()
        .lpush(RECENT_CALLS_KEY, JSON.stringify(call))
        .ltrim(RECENT_CALLS_KEY, 0, RECENT_CALLS_KEEP - 1)
        .exec();
    } catch (err) {
      this.logger.warn(`Recent calls: push failed — ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Up to `n` calls, newest start first, each sid once. */
  async read(n: number): Promise<EnrichedCall[]> {
    if (!this.redis) return [];
    let raw: string[];
    try {
      raw = await this.redis.client.lrange(RECENT_CALLS_KEY, 0, RECENT_CALLS_KEEP - 1);
    } catch (err) {
      this.logger.warn(`Recent calls: read failed — ${err instanceof Error ? err.message : err}`);
      return [];
    }
    const seen = new Set<string>();
    const out: EnrichedCall[] = [];
    for (const entry of raw ?? []) {
      try {
        const call = JSON.parse(entry) as EnrichedCall;
        if (!call?.callSid || seen.has(call.callSid)) continue;
        seen.add(call.callSid);
        out.push(call);
      } catch {
        // A malformed entry is skipped, never served.
      }
    }
    return out
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .slice(0, n);
  }
}
