import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SearchDocument, SearchType } from '@bitcrm/types';
import { SearchIndexerService } from '../indexer.service';
import { routeToDocument } from '../index-router';
import { CatalogNamesService } from '../catalog-names.service';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

const CRM = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const USER = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const DEAL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INVENTORY = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4004';
const MESSAGING = process.env.MESSAGING_SERVICE_URL || 'http://localhost:4007';

/**
 * Internal "list all" endpoints used to (re)build the index from scratch. Each is
 * expected to return `{ items: Entity[], nextCursor?: string }` (the repos' shared
 * PaginatedResult shape). Missing endpoints are logged and skipped rather than
 * failing the whole backfill.
 */
export const SOURCES: Array<{ type: SearchType; base: string }> = [
  { type: 'deal', base: `${DEAL}/api/deals/internal/all` },
  { type: 'contact', base: `${CRM}/api/crm/contacts/internal/all` },
  { type: 'company', base: `${CRM}/api/crm/companies/internal/all` },
  { type: 'user', base: `${USER}/api/users/internal/all` },
  { type: 'product', base: `${INVENTORY}/api/inventory/products/internal/all` },
  { type: 'warehouse', base: `${INVENTORY}/api/inventory/warehouses/internal/all` },
  { type: 'container', base: `${INVENTORY}/api/inventory/containers/internal/all` },
  { type: 'transfer', base: `${INVENTORY}/api/inventory/transfers/internal/all` },
  // Messaging walks the InboxIndex year partitions (open, then archived) — see
  // ConversationsRepository.listAll. Each thread then costs a feed read plus
  // party / job lookups, which is why the run is rate-limited (BackfillOptions).
  { type: 'conversation', base: `${MESSAGING}/api/messaging/conversations/internal/all` },
];

const PAGE_SIZE = 200;

/**
 * Pacing of a run. The conversation source is the expensive one: ~73k
 * threads, each enriched with a messages page and party / job fetches
 * against messaging, crm, user and deal — so enrichment is bounded to
 * `concurrency` in flight per page, and `pageDelayMs` spaces the pages
 * (0 = none). Env: SEARCH_BACKFILL_CONCURRENCY, SEARCH_BACKFILL_PAGE_DELAY_MS.
 */
export interface BackfillOptions {
  concurrency?: number;
  pageDelayMs?: number;
  /** Injectable clock for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Injection token for BackfillOptions — unset in the app (env defaults apply), passed in tests. */
export const BACKFILL_OPTIONS = Symbol('BACKFILL_OPTIONS');

export const BACKFILL_DEFAULTS = {
  concurrency: Math.max(1, Number(process.env.SEARCH_BACKFILL_CONCURRENCY) || 8),
  pageDelayMs: Math.max(0, Number(process.env.SEARCH_BACKFILL_PAGE_DELAY_MS) || 0),
} as const;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `Promise.all(items.map(fn))` with at most `limit` calls in flight; order preserved. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

/**
 * Authoritative index populator. Pages every entity out of each owning service and
 * bulk-upserts mapped documents. Idempotent (upsert-only) — safe to re-run and the
 * canonical repair for drift. Reindex-with-alias-swap is orchestrated by the caller.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);
  private readonly concurrency: number;
  private readonly pageDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly indexer: SearchIndexerService,
    private readonly catalogNames: CatalogNamesService,
    @Optional() @Inject(BACKFILL_OPTIONS) options?: BackfillOptions,
  ) {
    this.concurrency = options?.concurrency ?? BACKFILL_DEFAULTS.concurrency;
    this.pageDelayMs = options?.pageDelayMs ?? BACKFILL_DEFAULTS.pageDelayMs;
    this.sleep = options?.sleep ?? defaultSleep;
  }

  /** Rebuild all types, or only the given ones (e.g. `['deal']` after a custom-field toggle). */
  async run(types?: SearchType[]): Promise<Record<string, number>> {
    const sources = types
      ? SOURCES.filter((s) => types.includes(s.type))
      : SOURCES;
    const totals: Record<string, number> = {};
    for (const source of sources) {
      try {
        totals[source.type] = await this.backfillType(source.type, source.base);
      } catch (err) {
        this.logger.error(
          `Backfill for ${source.type} failed: ${(err as Error).message}`,
        );
        totals[source.type] = -1;
      }
    }
    this.logger.log(`Backfill complete: ${JSON.stringify(totals)}`);
    return totals;
  }

  private async backfillType(type: SearchType, base: string): Promise<number> {
    let cursor: string | undefined;
    let count = 0;
    let pages = 0;
    // Deals denormalize their client and conversations their party and jobs;
    // one contact owns many deals and one deal many messages, so those
    // fetches are cached (`type#id`) across the whole run.
    const fetchCache = new Map<string, any | null>();
    do {
      if (pages > 0 && this.pageDelayMs > 0) await this.sleep(this.pageDelayMs);
      pages += 1;

      const url = new URL(base);
      url.searchParams.set('limit', String(PAGE_SIZE));
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString(), {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${base}`);
      }
      // Internal endpoints wrap results as { success, data: { items, nextCursor } };
      // tolerate an unwrapped { items, nextCursor } too.
      const body = (await res.json()) as any;
      const page: { items?: any[]; nextCursor?: string } = body?.data ?? body;
      const items = page.items ?? [];
      const docs = (
        await mapLimit(items, this.concurrency, (e) => this.toDocument(type, e, fetchCache))
      ).filter((d): d is SearchDocument => d !== null);

      count += await this.indexer.bulkIndex(docs);
      cursor = page.nextCursor;
    } while (cursor);

    this.logger.log(`Backfilled ${count} ${type} docs in ${pages} page(s)`);
    return count;
  }

  /** One entity → its document, with whatever enrichment its type needs. */
  private async toDocument(
    type: SearchType,
    e: any,
    fetchCache: Map<string, any | null>,
  ): Promise<SearchDocument | null> {
    if (type === 'conversation') {
      const context = await this.indexer.resolveConversationContext(e, fetchCache);
      return routeToDocument(type, e, undefined, [], [], undefined, undefined, context);
    }
    if (type !== 'deal') return routeToDocument(type, e);

    const [jobTypeName, ...tagNames] = await Promise.all([
      this.catalogNames.nameOf('job-types', e?.jobTypeId),
      ...((e?.tagIds ?? []) as string[]).map((id) => this.catalogNames.nameOf('job-tags', id)),
    ]);
    const customFieldDefs = await this.catalogNames.customFieldDefs();
    const client =
      e?.contactId || e?.companyId
        ? await this.indexer.resolveDealClient(e, fetchCache)
        : undefined;
    const externalCompanyName = await this.catalogNames.nameOf(
      'external-companies',
      e?.externalCompanyId,
    );
    return routeToDocument(
      type,
      e,
      jobTypeName,
      tagNames.filter((n): n is string => Boolean(n)),
      customFieldDefs,
      client,
      externalCompanyName,
    );
  }
}
