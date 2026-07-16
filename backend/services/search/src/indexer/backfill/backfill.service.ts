import { Injectable, Logger } from '@nestjs/common';
import { SearchDocument, SearchType } from '@bitcrm/types';
import { SearchIndexerService } from '../indexer.service';
import { routeToDocument } from '../index-router';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

const CRM = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const USER = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const DEAL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INVENTORY = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4004';

/**
 * Internal "list all" endpoints used to (re)build the index from scratch. Each is
 * expected to return `{ items: Entity[], nextCursor?: string }` (the repos' shared
 * PaginatedResult shape). Missing endpoints are logged and skipped rather than
 * failing the whole backfill.
 */
const SOURCES: Array<{ type: SearchType; base: string }> = [
  { type: 'deal', base: `${DEAL}/api/deals/internal/all` },
  { type: 'contact', base: `${CRM}/api/crm/contacts/internal/all` },
  { type: 'company', base: `${CRM}/api/crm/companies/internal/all` },
  { type: 'user', base: `${USER}/api/users/internal/all` },
  { type: 'product', base: `${INVENTORY}/api/inventory/products/internal/all` },
  { type: 'warehouse', base: `${INVENTORY}/api/inventory/warehouses/internal/all` },
  { type: 'container', base: `${INVENTORY}/api/inventory/containers/internal/all` },
  { type: 'transfer', base: `${INVENTORY}/api/inventory/transfers/internal/all` },
];

const PAGE_SIZE = 200;

/**
 * Authoritative index populator. Pages every entity out of each owning service and
 * bulk-upserts mapped documents. Idempotent (upsert-only) — safe to re-run and the
 * canonical repair for drift. Reindex-with-alias-swap is orchestrated by the caller.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(private readonly indexer: SearchIndexerService) {}

  async run(): Promise<Record<string, number>> {
    const totals: Record<string, number> = {};
    for (const source of SOURCES) {
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
    do {
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
      const docs = items
        .map((e) => routeToDocument(type, e))
        .filter((d): d is SearchDocument => d !== null);

      count += await this.indexer.bulkIndex(docs);
      cursor = page.nextCursor;
    } while (cursor);

    this.logger.log(`Backfilled ${count} ${type} docs`);
    return count;
  }
}
