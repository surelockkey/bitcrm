/**
 * One-shot index backfill: pages every entity out of the owning services and
 * bulk-upserts mapped documents. Run after first deploy and after a reindex.
 * Idempotent (upsert-only).
 *
 *   npm run backfill                       # every type
 *   npm run backfill -- conversation       # only the inbox threads (messaging export)
 *   npm run backfill -- deal contact       # any subset of SEARCH_TYPES
 *
 * Pacing: SEARCH_BACKFILL_CONCURRENCY (enrichment fetches in flight per page,
 * default 8) and SEARCH_BACKFILL_PAGE_DELAY_MS (pause between pages, default 0)
 * — see BackfillOptions.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { SEARCH_TYPES, SearchType } from '@bitcrm/types';
import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SearchIndexerService } from '../indexer/indexer.service';
import { BACKFILL_DEFAULTS, BackfillService } from '../indexer/backfill/backfill.service';
import { CatalogNamesService } from '../indexer/catalog-names.service';
import { EntityFetcher } from '../indexer/entity-fetcher.service';

/** `npm run backfill -- conversation deal` → ['conversation', 'deal']; nothing → undefined (all). */
export function parseTypes(argv: string[]): SearchType[] | undefined {
  const wanted = argv.map((a) => a.trim()).filter(Boolean);
  if (wanted.length === 0) return undefined;
  const unknown = wanted.filter((t) => !(SEARCH_TYPES as readonly string[]).includes(t));
  if (unknown.length > 0) {
    throw new Error(`Unknown search type(s): ${unknown.join(', ')}. Known: ${SEARCH_TYPES.join(', ')}`);
  }
  return wanted as SearchType[];
}

async function main() {
  const types = parseTypes(process.argv.slice(2));
  const opensearch = new OpenSearchService();
  const catalogNames = new CatalogNamesService();
  const indexer = new SearchIndexerService(opensearch, catalogNames, new EntityFetcher());
  const backfill = new BackfillService(indexer, catalogNames);

  console.log(
    `Backfill ${types ? types.join(', ') : 'all types'} ` +
      `(concurrency ${BACKFILL_DEFAULTS.concurrency}, page delay ${BACKFILL_DEFAULTS.pageDelayMs} ms)`,
  );
  const totals = await backfill.run(types);
  console.log('Backfill totals:', totals);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill failed:', err);
      process.exit(1);
    });
}
