/**
 * The string commands the shared caches use (GET/SET/MGET/INCR/DEL + MULTI),
 * in memory. `fail` makes every command reject — Redis being down must
 * degrade a cache to "no cache", never to an error.
 */
export class FakeRedisKv {
  strings = new Map<string, string>();
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
  async set(key: string, value: string, ..._args: unknown[]) {
    this.guard('set');
    this.strings.set(key, value);
    return 'OK';
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
    const chain = {
      incr: (key: string) => (ops.push(() => this.incr(key)), chain),
      del: (...keys: string[]) => (ops.push(() => this.del(...keys)), chain),
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
