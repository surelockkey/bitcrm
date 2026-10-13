/**
 * One value cached in process for `ttlMs`, single-flight, invalidated locally.
 *
 * For small DynamoDB lists read on hot paths (call flows, number settings —
 * both on every call-record write). Per process on purpose: the writer's own
 * task sees its change at once, every other task within the TTL.
 *
 * - Never caches an error: a failed load rejects and the next call retries.
 * - `invalidate()` during a load disowns it, so a read that started before a
 *   write can never become the cached value afterwards.
 */
export class LocalTtlCache<T> {
  private value: { v: T; expiresAt: number } | null = null;
  private inflight: Promise<T> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(loader: () => Promise<T>): Promise<T> {
    if (this.value && this.value.expiresAt > this.now()) {
      return Promise.resolve(this.value.v);
    }
    if (this.inflight) return this.inflight;

    const flight = loader().then((v) => {
      if (this.inflight === flight) {
        this.value = { v, expiresAt: this.now() + this.ttlMs };
      }
      return v;
    });
    this.inflight = flight;
    const clear = () => {
      if (this.inflight === flight) this.inflight = null;
    };
    flight.then(clear, clear);
    return flight;
  }

  invalidate(): void {
    this.value = null;
    this.inflight = null;
  }
}
