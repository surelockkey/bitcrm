/**
 * Creates the versioned search index (if absent) and points the read/write alias
 * at it — atomically swapping the alias off any previous version. Idempotent, so
 * it is safe to run on every deploy or as a one-off ECS task. For a mapping change,
 * bump SEARCH_INDEX_NAME (…-v2), run this, then run the backfill against the new
 * index before the alias moves — here we swap immediately after creation.
 *
 *   npm run create-index
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { OpenSearchService } from '../common/opensearch/opensearch.service';
import {
  SEARCH_INDEX_ALIAS,
  SEARCH_INDEX_NAME,
} from '../common/constants/opensearch.constants';
import { INDEX_BODY } from './index-definition';

async function main() {
  const client = new OpenSearchService().client;

  const exists = await client.indices.exists({ index: SEARCH_INDEX_NAME });
  if (!(exists as any).body) {
    console.log(`Creating index ${SEARCH_INDEX_NAME}…`);
    await client.indices.create({
      index: SEARCH_INDEX_NAME,
      body: INDEX_BODY as any,
    });
  } else {
    console.log(`Index ${SEARCH_INDEX_NAME} already exists.`);
  }

  // Point the alias at this version, removing it from any others (atomic).
  let existingAlias: any = {};
  try {
    const res = await client.indices.getAlias({ name: SEARCH_INDEX_ALIAS });
    existingAlias = (res as any).body || {};
  } catch {
    // alias doesn't exist yet — fine
  }

  const actions: any[] = [];
  for (const idx of Object.keys(existingAlias)) {
    if (idx !== SEARCH_INDEX_NAME) {
      actions.push({ remove: { index: idx, alias: SEARCH_INDEX_ALIAS } });
    }
  }
  actions.push({ add: { index: SEARCH_INDEX_NAME, alias: SEARCH_INDEX_ALIAS } });

  await client.indices.updateAliases({ body: { actions } });
  console.log(`Alias ${SEARCH_INDEX_ALIAS} → ${SEARCH_INDEX_NAME}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('create-index failed:', err);
    process.exit(1);
  });
