/** How long a catalog list is served from memory before it is read again. */
export const CATALOG_CACHE_TTL_MS = 60_000;

/**
 * An in-process copy of one catalog's full list (job types, sources, tags,
 * custom fields, sub-statuses, service areas, external companies, client tags).
 *
 * These lists are read on every page load and by the other services'
 * `/internal` routes, and after the Workiz import they are big (898 job
 * types, 691 sources): reading them uncached cost ~450 ms a request. The
 * owning service keeps one `CatalogCache` and derives every variant
 * (`activeOnly`, `/internal`) from the cached full list instead of
 * re-querying.
 *
 * - **TTL** — `CATALOG_CACHE_TTL_MS` (60 s).
 * - **Single-flight** — concurrent misses share one in-flight read.
 * - **Invalidation is local.** The service calls `invalidate()` after every
 *   create / update / delete / archive, so the task that took the write sees
 *   it at once. Other tasks of the same service keep their copy until the TTL
 *   runs out: cross-task staleness is bounded by 60 s, not zero. Checks that
 *   must see the latest rows at write time (name uniqueness, coverage
 *   overlap) read the repository directly, not this cache.
 * - A failed read is never cached, and a read that was in flight when
 *   `invalidate()` ran is not kept (it may predate the write).
 *
 * `get()` hands each caller its own array, so sorting or filtering it is
 * safe; the rows themselves are shared — treat them as read-only.
 */
export class CatalogCache<T> {
  private value?: { rows: T[]; at: number };
  private inflight?: Promise<T[]>;
  private generation = 0;

  constructor(
    private readonly load: () => Promise<T[]>,
    private readonly ttlMs: number = CATALOG_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<T[]> {
    if (this.value && this.now() - this.value.at < this.ttlMs) return this.value.rows.slice();
    if (!this.inflight) {
      const generation = this.generation;
      const read = this.load()
        .then((rows) => {
          if (generation === this.generation) this.value = { rows, at: this.now() };
          return rows;
        })
        .finally(() => {
          if (this.inflight === read) this.inflight = undefined;
        });
      this.inflight = read;
    }
    return (await this.inflight).slice();
  }

  /** Drop the cached list (and any read in flight): the next `get()` reads again. */
  invalidate(): void {
    this.generation += 1;
    this.value = undefined;
    this.inflight = undefined;
  }
}
