/**
 * Strip the legacy tech-index keys from deal METADATA rows.
 *
 * WHY
 * ---
 * Under the old single-assignee model a deal's own METADATA row carried
 * `GSI2PK = TECH#<techId>`, so the tech index pointed straight at it. The
 * multi-tech model moved that to adjacency rows (`SK = ASSIGN#<techId>`), and
 * `deals.repository.ts` says so at the write path: "The tech index lives on the
 * assignment rows now, so metadata only owns the super-status index here."
 *
 * `migrate-deal-assignments.ts` was meant to clear those keys, but its skip
 * condition is `assignedTechIds is an array && assignedTechId is undefined` —
 * so any deal that already had the array was skipped WITH its stale keys
 * intact. Those rows are still in the index today.
 *
 * TWO THINGS THIS FIXES
 * ---------------------
 * 1. A 500 on `GET /deals?techId=…`. `findByTech` maps `dealId` over every
 *    index row, and METADATA rows have no `dealId` attribute — so two or more
 *    of them produce two `PK: "DEAL#undefined"` keys in one BatchGetItem, and
 *    DynamoDB rejects the whole call: "Provided list of item keys contains
 *    duplicates". One stale row degrades silently; two is a hard failure.
 *
 * 2. Worse, and quieter: a deal whose METADATA still points at a technician it
 *    is no longer assigned to shows up in that technician's job list. The
 *    index disagrees with the record, and the index is what the list reads.
 *
 * SAFETY
 * ------
 * Removing an index key is destructive if it is the ONLY route to a real
 * assignment, so every row is checked before it is touched: for each id in
 * `assignedTechIds`, an `ASSIGN#<techId>` row must already exist. Anything
 * that fails that check is REPORTED AND SKIPPED rather than fixed — a deal
 * that would lose an assignment needs a human, not a migration.
 *
 * `TECH#UNASSIGNED` is a sentinel from the same era. Nothing in the source
 * reads or writes it (`grep -rn UNASSIGNED backend/services/deal/src` finds
 * only timeline event types), so it is cleared like any other stale key.
 *
 * Idempotent: a row with no `GSI2PK` is never visited twice.
 *
 * Usage:
 *   ts-node src/scripts/backfill-tech-index.ts            # dry run (default)
 *   ts-node src/scripts/backfill-tech-index.ts --apply
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
/** Destructive on production data, so nothing happens without saying so. */
const APPLY = process.argv.includes('--apply');

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
);

/** The technicians that already have an adjacency row on this deal. */
async function assignedViaRows(dealId: string): Promise<Set<string>> {
  const res = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :assign)',
      ExpressionAttributeValues: {
        ':pk': `DEAL#${dealId}`,
        ':assign': 'ASSIGN#',
      },
      ProjectionExpression: 'SK',
    }),
  );
  return new Set(
    (res.Items ?? []).map((i) => String(i.SK).replace('ASSIGN#', '')),
  );
}

async function main(): Promise<void> {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  let scanned = 0;
  let cleared = 0;
  const blocked: string[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'SK = :meta AND attribute_exists(GSI2PK)',
        ExpressionAttributeValues: { ':meta': 'METADATA' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      scanned += 1;
      const dealId = item.id as string;
      const stale = item.GSI2PK as string;
      const techIds = (item.assignedTechIds as string[] | undefined) ?? [];

      // The check that makes this safe: every real assignment must already
      // have its own index row, or removing this key loses it.
      const covered = techIds.length ? await assignedViaRows(dealId) : new Set<string>();
      const orphaned = techIds.filter((t) => !covered.has(t));

      if (orphaned.length > 0) {
        blocked.push(
          `  ! ${dealId}: assigned to [${orphaned.join(', ')}] with no ASSIGN# row — ` +
            `run migrate-deal-assignments.ts first`,
        );
        continue;
      }

      const why =
        stale === 'TECH#UNASSIGNED'
          ? 'legacy unassigned sentinel'
          : techIds.length === 0
            ? `points at ${stale.replace('TECH#', '')} but nobody is assigned`
            : 'already covered by ASSIGN# rows';
      console.log(`  ~ ${dealId}: clearing ${stale} — ${why}`);

      if (APPLY) {
        await client.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `DEAL#${dealId}`, SK: 'METADATA' },
            UpdateExpression: 'REMOVE GSI2PK, GSI2SK',
            // Never resurrect a deleted deal as a side effect of housekeeping.
            ConditionExpression: 'attribute_exists(PK)',
          }),
        );
      }
      cleared += 1;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  if (blocked.length) {
    console.log(`\n${blocked.length} deal(s) SKIPPED — they need attention first:`);
    blocked.forEach((line) => console.log(line));
  }

  console.log(
    `\n${scanned} stale metadata row(s) found, ${cleared} cleared` +
      `${blocked.length ? `, ${blocked.length} skipped` : ''}` +
      `${APPLY ? '.' : ' (dry run — nothing written).'}`,
  );
  if (!APPLY && cleared > 0) console.log('Re-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
