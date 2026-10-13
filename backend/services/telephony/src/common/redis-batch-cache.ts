import { Logger } from '@nestjs/common';
import { type RedisService } from '@bitcrm/shared';

export interface RedisBatchCacheOptions {
  /** How long a found value is kept. */
  hitTtlMs: number;
  /** How long a confirmed miss (`null`) is kept. */
  missTtlMs: number;
  /**
   * The in-process layer in front of Redis — absorbs the burst of lookups one
   * page render or one SSE fan-out makes. Never longer than the entry's own
   * TTL. Without Redis it is the whole cache and keeps entries their full TTL.
   */
  l1TtlMs?: number;
  /** Entries the in-process layer holds before it starts over. */
  l1Max?: number;
}

/**
 * What a loader answers: key → value, or `null` for a confirmed miss ("nobody
 * owns this number"). A key it leaves OUT is unknown — the upstream failed for
 * it — and is never cached, so the next ask retries.
 */
export type BatchLoad<V> = (keys: string[]) => Promise<Map<string, V | null>>;

const DEFAULT_L1_TTL_MS = 10_000;
const DEFAULT_L1_MAX = 5_000;

/**
 * Many small values (a name per phone number, per user id) cached in Redis and
 * shared by every task, with hits and misses kept for different times.
 *
 * - **One round trip per batch**: MGET for the lookup, one MULTI of `SET … PX`
 *   for what was loaded.
 * - **Single-flight per key, per process**: concurrent asks for a key that is
 *   already being loaded wait for that load instead of starting another.
 * - **Never caches a failure** (see {@link BatchLoad}).
 * - **Redis being down degrades to the in-process layer**, never to an error.
 */
export class RedisBatchCache<V> {
  private readonly logger = new Logger(RedisBatchCache.name);
  private readonly l1 = new Map<string, { v: V | null; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<V | null | undefined>>();

  constructor(
    private readonly redis: RedisService | undefined,
    private readonly prefix: string,
    private readonly options: RedisBatchCacheOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The values of `keys` that exist (misses and failures are absent). */
  async getMany(keys: string[], load: BatchLoad<V>): Promise<Map<string, V>> {
    const unique = [...new Set(keys)];
    const out = new Map<string, V>();
    const settle = (key: string, v: V | null | undefined) => {
      if (v !== null && v !== undefined) out.set(key, v);
    };

    // 1. In process.
    const now = this.now();
    let todo: string[] = [];
    for (const key of unique) {
      const hit = this.l1.get(key);
      if (hit && hit.expiresAt > now) settle(key, hit.v);
      else todo.push(key);
    }
    if (!todo.length) return out;

    // 2. Already being loaded here.
    const waiting: Array<Promise<void>> = [];
    todo = todo.filter((key) => {
      const flight = this.inflight.get(key);
      if (!flight) return true;
      waiting.push(flight.then((v) => settle(key, v)));
      return false;
    });

    // 3. Redis, then the loader — as one flight the keys can be waited on.
    if (todo.length) {
      const batch = this.fetch(todo, load);
      for (const key of todo) {
        const flight = batch.then((m) => m.get(key));
        this.inflight.set(key, flight);
        const clear = () => {
          if (this.inflight.get(key) === flight) this.inflight.delete(key);
        };
        flight.then(clear, clear);
      }
      const found = await batch;
      for (const key of todo) settle(key, found.get(key));
    }
    await Promise.all(waiting);
    return out;
  }

  /** Forget `keys` everywhere (this process and Redis). */
  async invalidate(keys: string[]): Promise<void> {
    if (!keys.length) return;
    keys.forEach((k) => this.l1.delete(k));
    if (!this.redis) return;
    try {
      await this.redis.client.del(...keys.map((k) => this.redisKey(k)));
    } catch (error) {
      this.logger.warn(`${this.prefix}: invalidate failed: ${this.reason(error)}`);
    }
  }

  /** Redis for what it has, the loader for the rest. Never rejects. */
  private async fetch(keys: string[], load: BatchLoad<V>): Promise<Map<string, V | null | undefined>> {
    const out = new Map<string, V | null | undefined>();
    let missing = keys;

    if (this.redis) {
      try {
        const raw = await this.redis.client.mget(...keys.map((k) => this.redisKey(k)));
        missing = [];
        keys.forEach((key, i) => {
          const entry = raw?.[i];
          if (typeof entry !== 'string') {
            missing.push(key);
            return;
          }
          try {
            const { v } = JSON.parse(entry) as { v: V | null };
            out.set(key, v);
            this.remember(key, v);
          } catch {
            missing.push(key);
          }
        });
      } catch (error) {
        this.logger.warn(`${this.prefix}: read failed: ${this.reason(error)}`);
        missing = keys;
      }
    }
    if (!missing.length) return out;

    let loaded: Map<string, V | null>;
    try {
      loaded = await load(missing);
    } catch (error) {
      this.logger.warn(`${this.prefix}: load failed: ${this.reason(error)}`);
      return out;
    }

    const writes: Array<[string, string, number]> = [];
    for (const key of missing) {
      if (!loaded.has(key)) continue; // failed upstream — not cached
      const v = loaded.get(key) ?? null;
      out.set(key, v);
      this.remember(key, v);
      writes.push([this.redisKey(key), JSON.stringify({ v }), this.ttlOf(v)]);
    }
    if (writes.length && this.redis) {
      try {
        const multi = this.redis.client.multi();
        for (const [k, json, ttl] of writes) multi.set(k, json, 'PX', ttl);
        await multi.exec();
      } catch (error) {
        this.logger.warn(`${this.prefix}: write failed: ${this.reason(error)}`);
      }
    }
    return out;
  }

  private remember(key: string, v: V | null): void {
    const l1Ttl = this.redis
      ? Math.min(this.options.l1TtlMs ?? DEFAULT_L1_TTL_MS, this.ttlOf(v))
      : this.ttlOf(v);
    if (l1Ttl <= 0) return;
    if (this.l1.size >= (this.options.l1Max ?? DEFAULT_L1_MAX)) this.l1.clear();
    this.l1.set(key, { v, expiresAt: this.now() + l1Ttl });
  }

  private ttlOf(v: V | null): number {
    return v === null ? this.options.missTtlMs : this.options.hitTtlMs;
  }

  private redisKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
