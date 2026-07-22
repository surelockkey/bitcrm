import { Injectable, Logger } from '@nestjs/common';

const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** Catalogs the indexer has to resolve ids against. */
export type CatalogKind = 'job-types' | 'service-areas';

/** Names go stale only when someone edits a catalog, which is rare. */
const TTL_MS = 5 * 60 * 1000;

interface CachedCatalog {
  names: Map<string, string>;
  fetchedAt: number;
}

/**
 * Deals and technicians store catalog *ids*; search documents must show names.
 * Both catalogs are tiny and change rarely, so the indexer keeps them in memory
 * rather than joining per document. The `job-type.*` / `service-area.*` events
 * the indexer already receives invalidate the cache; the TTL is the backstop.
 */
@Injectable()
export class CatalogNamesService {
  private readonly logger = new Logger(CatalogNamesService.name);
  private readonly cache = new Map<CatalogKind, CachedCatalog>();

  /** Drop a cached catalog so the next lookup refetches it. */
  invalidate(kind: CatalogKind): void {
    this.cache.delete(kind);
  }

  /** The catalog entry's name, or undefined if the id is unknown. */
  async nameOf(kind: CatalogKind, id?: string): Promise<string | undefined> {
    if (!id) return undefined;
    const catalog = await this.load(kind);
    return catalog.get(id);
  }

  private async load(kind: CatalogKind): Promise<Map<string, string>> {
    const cached = this.cache.get(kind);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.names;

    try {
      const res = await fetch(`${DEAL_SERVICE_URL}/api/deals/${kind}/internal`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as { data?: Array<{ id: string; name: string }> };
      const names = new Map((body.data ?? []).map((e) => [e.id, e.name]));
      this.cache.set(kind, { names, fetchedAt: Date.now() });
      return names;
    } catch (err) {
      // A stale catalog beats an unindexed document; an empty one beats a crash.
      this.logger.warn(`Failed to load ${kind} catalog: ${(err as Error).message}`);
      return cached?.names ?? new Map();
    }
  }
}
