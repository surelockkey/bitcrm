import { Logger } from '@nestjs/common';
import { type RedisService } from '@bitcrm/shared';

export interface RedisSwrCacheOptions {
  /** Served as-is, no reload, while younger than this. */
  freshMs: number;
  /**
   * Older than `freshMs` but younger than this: served immediately while ONE
   * background reload (per process) replaces it. Older still: the caller waits
   * for the reload — and still gets this value if the reload fails.
   */
  staleMs: number;
  /**
   * How long Redis keeps the value at all — the last-good fallback for when
   * the source is failing. Defaults to a day.
   */
  retainMs?: number;
}

/** What sits in Redis under the key. */
interface Entry<T> {
  v: T;
  /** Epoch ms the value was loaded. */
  at: number;
  /** The generation the load started under — see `invalidate`. */
  gen: string;
}

const DEFAULT_RETAIN_MS = 24 * 60 * 60_000;

/**
 * A single value cached in Redis, shared by every task of the service, with
 * stale-while-revalidate and last-good fallback. Built for slow upstream lists
 * (Twilio's owned numbers: a paged walk that cost ~300 ms p50 / ~1.2 s p95 on
 * every request).
 *
 * - **Never caches an error.** A failed load rejects (or falls back to the
 *   value already held); nothing is written.
 * - **Single-flight per process.** Concurrent misses share one load. Across
 *   tasks each may load once per expiry — cheap enough not to need a lock.
 * - **Invalidation is a generation bump** (`INCR <key>:gen` + `DEL <key>`). A
 *   load that started before the bump writes its result tagged with the old
 *   generation, which every reader treats as a miss — so a slow walk that
 *   began before a number was bought can never put the pre-buy list back.
 *   Read cost stays one round trip (`MGET key key:gen`).
 * - **Redis being down degrades to no cache**, never to an error.
 */
export class RedisSwrCache<T> {
  private readonly logger = new Logger(RedisSwrCache.name);
  private inflight: Promise<T> | null = null;
  private readonly genKey: string;

  constructor(
    private readonly redis: RedisService | undefined,
    private readonly key: string,
    private readonly options: RedisSwrCacheOptions,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.genKey = `${key}:gen`;
  }

  async get(loader: () => Promise<T>): Promise<T> {
    if (!this.redis) return loader();

    const { entry, gen } = await this.read();
    const current = entry && entry.gen === gen ? entry : null;
    const age = current ? this.now() - current.at : Infinity;

    if (current && age < this.options.freshMs) return current.v;

    if (current && age < this.options.staleMs) {
      // Serve now; the reload's own failure is logged inside `refresh`.
      this.refresh(loader, gen).catch(() => undefined);
      return current.v;
    }

    try {
      return await this.refresh(loader, gen);
    } catch (error) {
      // Any value at all beats an error here — including one from before an
      // invalidation: a list that is a purchase behind is still the account.
      if (entry) {
        this.logger.warn(
          `${this.key}: reload failed, serving the cached value: ${this.reason(error)}`,
        );
        return entry.v;
      }
      throw error;
    }
  }

  /** Drop the value for every task; loads already running are disowned. */
  async invalidate(): Promise<void> {
    this.inflight = null;
    if (!this.redis) return;
    try {
      await this.redis.client.multi().incr(this.genKey).del(this.key).exec();
    } catch (error) {
      this.logger.warn(`${this.key}: invalidate failed: ${this.reason(error)}`);
    }
  }

  private refresh(loader: () => Promise<T>, gen: string): Promise<T> {
    if (this.inflight) return this.inflight;
    const flight = loader().then(
      async (value) => {
        // Only the flight still owned by this cache may write: `invalidate`
        // disowns it locally, the generation tag disowns it everywhere else.
        if (this.inflight === flight) await this.write(value, gen);
        return value;
      },
      (error: unknown) => {
        this.logger.warn(`${this.key}: load failed: ${this.reason(error)}`);
        throw error;
      },
    );
    this.inflight = flight;
    const clear = () => {
      if (this.inflight === flight) this.inflight = null;
    };
    flight.then(clear, clear);
    return flight;
  }

  private async read(): Promise<{ entry: Entry<T> | null; gen: string }> {
    try {
      const [raw, gen] = await this.redis!.client.mget(this.key, this.genKey);
      return { entry: raw ? (JSON.parse(raw) as Entry<T>) : null, gen: gen ?? '0' };
    } catch (error) {
      this.logger.warn(`${this.key}: read failed: ${this.reason(error)}`);
      return { entry: null, gen: '0' };
    }
  }

  private async write(value: T, gen: string): Promise<void> {
    const entry: Entry<T> = { v: value, at: this.now(), gen };
    try {
      await this.redis!.client.set(
        this.key,
        JSON.stringify(entry),
        'PX',
        this.options.retainMs ?? DEFAULT_RETAIN_MS,
      );
    } catch (error) {
      this.logger.warn(`${this.key}: write failed: ${this.reason(error)}`);
    }
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
