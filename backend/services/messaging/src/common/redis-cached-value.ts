import { Logger } from '@nestjs/common';
import { type RedisService } from '@bitcrm/shared';

/** What sits in Redis under the key. */
interface Entry<T> {
  v: T;
  /** The generation the load started under — see `invalidate`. */
  gen: string;
}

/**
 * One value (a catalog list) cached in Redis, shared by every task of the
 * service — the messaging cousin of telephony's `RedisSwrCache`, without the
 * stale-while-revalidate: a catalog is cheap enough to read on a miss, and an
 * edit must show on the next read everywhere, not after a background reload.
 *
 * - **Read through, TTL as the safety net.** The value lives `ttlSeconds`;
 *   writes made by anything that does not call `invalidate()` (an import
 *   straight into DynamoDB) show within that.
 * - **Invalidation is a generation bump** (`INCR <key>:gen` + `DEL <key>`),
 *   seen by every task at once. A load that started before the bump writes
 *   its answer tagged with the old generation, which every reader treats as
 *   a miss — so a read that began before an edit can never put the pre-edit
 *   list back. A read is still one round trip (`MGET key key:gen`).
 * - **Single-flight per process and generation.** Concurrent misses share one
 *   load; a `get()` after an `invalidate()` never joins a load from before it.
 * - **Never caches an error**, and **Redis being down degrades to no cache** —
 *   the loader answers, nothing throws because of Redis.
 */
export class RedisCachedValue<T> {
  private readonly logger = new Logger(RedisCachedValue.name);
  private readonly genKey: string;
  private inflight: { gen: string; promise: Promise<T> } | null = null;

  constructor(
    private readonly redis: RedisService | undefined,
    private readonly key: string,
    private readonly ttlSeconds: number,
  ) {
    this.genKey = `${key}:gen`;
  }

  async get(loader: () => Promise<T>): Promise<T> {
    if (!this.redis) return loader();

    const read = await this.read();
    if (!read) return this.load(loader, null);
    if (read.entry && read.entry.gen === read.gen) return read.entry.v;
    return this.load(loader, read.gen);
  }

  /** Drop the value for every task; loads already running are disowned. */
  async invalidate(): Promise<void> {
    this.inflight = null;
    if (!this.redis) return;
    try {
      await this.redis.client.multi().incr(this.genKey).del(this.key).exec();
    } catch (error) {
      this.logger.warn(`${this.key}: invalidate failed: ${reason(error)}`);
    }
  }

  /** `gen: null` — Redis did not answer: load, share, keep nothing. */
  private load(loader: () => Promise<T>, gen: string | null): Promise<T> {
    const flightGen = gen ?? '';
    if (this.inflight && this.inflight.gen === flightGen) return this.inflight.promise;

    const promise: Promise<T> = loader().then(async (value) => {
      // Only the flight this cache still owns may write: `invalidate` disowns
      // it locally, the generation tag disowns it on every other task.
      if (gen !== null && this.inflight?.promise === promise) await this.write(value, gen);
      return value;
    });
    this.inflight = { gen: flightGen, promise };
    const clear = () => {
      if (this.inflight?.promise === promise) this.inflight = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  private async read(): Promise<{ entry: Entry<T> | null; gen: string } | null> {
    let raw: string | null;
    let gen: string | null;
    try {
      [raw, gen] = await this.redis!.client.mget(this.key, this.genKey);
    } catch (error) {
      this.logger.warn(`${this.key}: read failed: ${reason(error)}`);
      return null;
    }
    let entry: Entry<T> | null = null;
    if (raw) {
      try {
        entry = JSON.parse(raw) as Entry<T>;
      } catch {
        entry = null; // a value from an older shape of this code: a miss
      }
    }
    return { entry, gen: gen ?? '0' };
  }

  private async write(value: T, gen: string): Promise<void> {
    try {
      await this.redis!.client.set(this.key, JSON.stringify({ v: value, gen } satisfies Entry<T>), 'EX', this.ttlSeconds);
    } catch (error) {
      this.logger.warn(`${this.key}: write failed: ${reason(error)}`);
    }
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
