/**
 * The string commands the shared caches use (GET/SET/MGET/INCR/DEL + MULTI),
 * in memory. `fail` makes every command reject — Redis being down must
 * degrade a cache to "no cache", never to an error.
 */
export class FakeRedisKv {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  /** The PX/EX arguments of every SET, by key — what TTL a write asked for. */
  ttls = new Map<string, unknown[]>();
  fail = false;
  calls: string[] = [];

  private guard(cmd: string) {
    this.calls.push(cmd);
    if (this.fail) throw new Error('redis down');
  }

  async get(key: string) {
    this.guard('get');
    return this.strings.get(key) ?? null;
  }
  async mget(...keys: string[]) {
    this.guard('mget');
    return keys.map((k) => this.strings.get(k) ?? null);
  }
  async set(key: string, value: string, ...args: unknown[]) {
    this.guard('set');
    this.strings.set(key, value);
    this.ttls.set(key, args);
    return 'OK';
  }
  async lpush(key: string, ...values: string[]) {
    this.guard('lpush');
    const list = this.lists.get(key) ?? [];
    for (const v of values) list.unshift(v);
    this.lists.set(key, list);
    return list.length;
  }
  async ltrim(key: string, start: number, stop: number) {
    this.guard('ltrim');
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, list.slice(start, stop + 1));
    return 'OK';
  }
  async lrange(key: string, start: number, stop: number) {
    this.guard('lrange');
    return (this.lists.get(key) ?? []).slice(start, stop + 1);
  }
  async incr(key: string) {
    this.guard('incr');
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }
  async del(...keys: string[]) {
    this.guard('del');
    keys.forEach((k) => this.strings.delete(k));
    return keys.length;
  }
  multi() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain: Record<string, (...args: any[]) => any> = {
      incr: (key: string) => (ops.push(() => this.incr(key)), chain),
      del: (...keys: string[]) => (ops.push(() => this.del(...keys)), chain),
      set: (key: string, value: string, ...args: unknown[]) => (ops.push(() => this.set(key, value, ...args)), chain),
      lpush: (key: string, ...values: string[]) => (ops.push(() => this.lpush(key, ...values)), chain),
      ltrim: (key: string, start: number, stop: number) => (ops.push(() => this.ltrim(key, start, stop)), chain),
      exec: async () => {
        if (this.fail) throw new Error('redis down');
        const out: Array<[Error | null, unknown]> = [];
        for (const op of ops) out.push([null, await op()]);
        return out;
      },
    };
    return chain;
  }
}
