/**
 * One-shot index backfill: pages every entity out of the owning services and
 * bulk-upserts mapped documents. Run after first deploy and after a reindex.
 * Idempotent (upsert-only).
 *
 *   npm run backfill
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SearchIndexerService } from '../indexer/indexer.service';
import { BackfillService } from '../indexer/backfill/backfill.service';
import { CatalogNamesService } from '../indexer/catalog-names.service';

async function main() {
  const opensearch = new OpenSearchService();
  const catalogNames = new CatalogNamesService();
  const indexer = new SearchIndexerService(opensearch, catalogNames);
  const backfill = new BackfillService(indexer, catalogNames);

  const totals = await backfill.run();
  console.log('Backfill totals:', totals);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill failed:', err);
    process.exit(1);
  });
