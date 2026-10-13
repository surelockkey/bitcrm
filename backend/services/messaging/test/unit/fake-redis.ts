/**
 * The slice of ioredis the messaging caches use, over a Map, with a clock
 * the test controls. `down()` makes every command reject, the way an
 * unreachable Redis does.
 */
export class FakeRedis {
  readonly store = new Map<string, { value: string; expiresAt?: number }>();
  now = 0;
  private broken = false;
  readonly calls: string[] = [];

  down(): void {
    this.broken = true;
  }

  up(): void {
    this.broken = false;
  }

  /** The value under `key`, unexpired, or null. */
  peek(key: string): string | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt !== undefined && hit.expiresAt <= this.now) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  /** Seconds left on `key` (`-1` without a TTL, `-2` when missing) — like `TTL`. */
  ttl(key: string): number {
    const hit = this.store.get(key);
    if (!hit || this.peek(key) === null) return -2;
    return hit.expiresAt === undefined ? -1 : Math.round((hit.expiresAt - this.now) / 1000);
  }

  async get(key: string): Promise<string | null> {
    this.guard('get');
    return this.peek(key);
  }

  async mget(...keys: Array<string | string[]>): Promise<Array<string | null>> {
    this.guard('mget');
    return keys.flat().map((k) => this.peek(k));
  }

  async set(key: string, value: string, mode?: 'EX' | 'PX', ttl?: number): Promise<'OK'> {
    this.guard('set');
    this.write(key, value, mode, ttl);
    return 'OK';
  }

  async del(...keys: Array<string | string[]>): Promise<number> {
    this.guard('del');
    let n = 0;
    for (const k of keys.flat()) if (this.store.delete(k)) n += 1;
    return n;
  }

  async incr(key: string): Promise<number> {
    this.guard('incr');
    const next = Number(this.peek(key) ?? '0') + 1;
    this.store.set(key, { value: String(next) });
    return next;
  }

  /** `multi()` / `pipeline()` — queued commands run on `exec()`. */
  multi(): FakeChain {
    return new FakeChain(this);
  }

  pipeline(): FakeChain {
    return new FakeChain(this);
  }

  write(key: string, value: string, mode?: 'EX' | 'PX', ttl?: number): void {
    const expiresAt = mode && ttl !== undefined ? this.now + (mode === 'EX' ? ttl * 1000 : ttl) : undefined;
    this.store.set(key, { value, expiresAt });
  }

  guard(command: string): void {
    this.calls.push(command);
    if (this.broken) throw new Error('Connection is closed');
  }
}

export class FakeChain {
  private readonly ops: Array<() => Promise<unknown>> = [];

  constructor(private readonly redis: FakeRedis) {}

  set(key: string, value: string, mode?: 'EX' | 'PX', ttl?: number): this {
    this.ops.push(() => this.redis.set(key, value, mode, ttl));
    return this;
  }

  del(...keys: string[]): this {
    this.ops.push(() => this.redis.del(...keys));
    return this;
  }

  incr(key: string): this {
    this.ops.push(() => this.redis.incr(key));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    this.redis.guard('exec');
    const out: Array<[Error | null, unknown]> = [];
    for (const op of this.ops) out.push([null, await op()]);
    return out;
  }
}

/** A `RedisService` look-alike around a `FakeRedis`. */
export const fakeRedisService = (redis: FakeRedis = new FakeRedis()) => ({ client: redis }) as any;
