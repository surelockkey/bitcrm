import { createHash } from 'crypto';
import { promisify } from 'util';
import { gunzip, gzip } from 'zlib';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { dashboardDay } from '@bitcrm/types';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const REPORT_WINDOW_CACHE_PREFIX = 'deal:report-window:v1:';
/** Optional DI token for `{ maxBytes }` — tests only; the service runs on the defaults. */
export const REPORT_WINDOW_CACHE_OPTIONS = 'REPORT_WINDOW_CACHE_OPTIONS';

/**
 * How long a window read is shared, by how settled the window is (its last
 * day against today on the account's calendar, America/New_York):
 *
 * - `open` — the window reaches today (or later): five minutes. Jobs are being
 *   created, scheduled and closed in it right now.
 * - `recent` — it ended in the last three days: thirty minutes. The office
 *   still closes yesterday's jobs out the next morning, and a report of
 *   "yesterday" must not freeze them for a day.
 * - `closed` — older: a day. A past period moves only when somebody edits an
 *   old job, and such an edit shows up when the entry expires.
 *
 * There is no write-time invalidation: these TTLs ARE the staleness bound.
 */
export const REPORT_WINDOW_TTL = { open: 300, recent: 1800, closed: 86_400 } as const;
const RECENT_DAYS = 3;

/**
 * Past this many bytes (gzipped) a window is not written to Redis at all — a
 * year of the Jobs report is ~45 000 rows, tens of MB of JSON, and one such
 * value must never sit in (or cross) Redis. Such a window is still served:
 * read from DynamoDB, and from the report's own in-process copy for a minute.
 * A quarter (~1 MB gzipped) is far below it.
 */
export const REPORT_WINDOW_CACHE_MAX_BYTES = 4 * 1024 * 1024;
/** JSON this long is not even compressed (gzip of it would hold the thread pool for seconds). */
const MAX_JSON_CHARS = 96 * 1024 * 1024;

const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The TTL of a window whose last day is `to` (YYYY-MM-DD, account calendar). */
export function reportWindowTtlSeconds(to: string, now: Date = new Date()): number {
  const today = dashboardDay(now);
  if (to >= today) return REPORT_WINDOW_TTL.open;
  if (to >= shiftDay(today, -RECENT_DAYS)) return REPORT_WINDOW_TTL.recent;
  return REPORT_WINDOW_TTL.closed;
}

/** A short name for a projection — in the key, so a deploy that changes one never reads the old shape. */
export function shapeTag(attributes: readonly string[]): string {
  return createHash('sha1').update(attributes.join(',')).digest('hex').slice(0, 8);
}

export interface ReportWindowKey {
  /** Which report's read (`jobs`, `stats`, `tax`, `commissions`…). */
  kind: string;
  /** The window's days, YYYY-MM-DD, on the account calendar — `to` decides the TTL. */
  from: string;
  to: string;
  /** Everything else that changes what the read returns: the date it is "by", a projection tag, a technician. */
  parts?: readonly string[];
}

/**
 * The reports' date-window reads (Jobs report, Job Statistics, Tax, the
 * commissions report), shared by every task of the service through Redis.
 *
 * A window read is a report's whole DynamoDB cost — paging, sorting and
 * filtering then run in memory — and it used to be kept a minute per task,
 * so a second task, a deploy or the next minute read it all again.
 *
 * - **Key** — `deal:report-window:v1:<kind>:<from>:<to>[:<part>…]`.
 * - **TTL** — `reportWindowTtlSeconds` (5 min / 30 min / 24 h).
 * - **Value** — the read's JSON, gzipped (repeated attribute names compress
 *   ~10×); never written past `REPORT_WINDOW_CACHE_MAX_BYTES`.
 * - **Single-flight** — concurrent misses for one key in this process share
 *   one read.
 * - **Best effort** — Redis down, or not wired (unit tests), costs the cache,
 *   never the report. A failed read is never stored.
 *
 * Values cross a JSON round trip: callers cache plain data (DynamoDB items),
 * never class instances or Maps.
 */
@Injectable()
export class ReportWindowCache {
  private readonly logger = new Logger(ReportWindowCache.name);
  private readonly flights = new Map<string, Promise<unknown>>();
  private readonly maxBytes: number;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(REPORT_WINDOW_CACHE_OPTIONS) opts?: { maxBytes?: number },
  ) {
    this.maxBytes = opts?.maxBytes ?? REPORT_WINDOW_CACHE_MAX_BYTES;
  }

  keyOf(w: ReportWindowKey): string {
    return `${REPORT_WINDOW_CACHE_PREFIX}${w.kind}:${w.from}:${w.to}${(w.parts ?? []).map((p) => `:${p}`).join('')}`;
  }

  /** The window's value: from Redis, else `load()` (once per key in flight) and stored. `fresh` skips the hit. */
  async read<T>(w: ReportWindowKey, load: () => Promise<T>, opts: { fresh?: boolean; now?: Date } = {}): Promise<T> {
    const key = this.keyOf(w);
    const inFlight = this.flights.get(key);
    if (inFlight && !opts.fresh) return inFlight as Promise<T>;

    const flight = (async () => {
      if (!opts.fresh) {
        const hit = await this.get<T>(key);
        if (hit !== undefined) return hit;
      }
      const value = await load();
      await this.put(key, value, reportWindowTtlSeconds(w.to, opts.now));
      return value;
    })();
    this.flights.set(key, flight);
    try {
      return await flight;
    } finally {
      if (this.flights.get(key) === flight) this.flights.delete(key);
    }
  }

  private async get<T>(key: string): Promise<T | undefined> {
    if (!this.redis) return undefined;
    try {
      const raw = await this.redis.client.getBuffer(key);
      if (!raw) return undefined;
      return JSON.parse((await gunzipAsync(raw)).toString('utf8')) as T;
    } catch (err) {
      this.logger.warn(`report window ${key}: cache read failed — reading DynamoDB: ${(err as Error).message}`);
      return undefined;
    }
  }

  private async put(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;
    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_JSON_CHARS) {
        this.logger.warn(`report window ${key}: ${json.length} chars of JSON — not cached`);
        return;
      }
      const packed = await gzipAsync(Buffer.from(json, 'utf8'));
      if (packed.length > this.maxBytes) {
        this.logger.warn(`report window ${key}: ${packed.length} bytes gzipped, over the ${this.maxBytes}-byte cap — not cached`);
        return;
      }
      await this.redis.client.set(key, packed, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`report window ${key}: cache write failed: ${(err as Error).message}`);
    }
  }
}
