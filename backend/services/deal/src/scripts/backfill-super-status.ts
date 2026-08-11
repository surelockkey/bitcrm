/**
 * Backfill every deal's `superStatus` from its legacy 13-stage `stage`, and
 * re-key the status GSI from `STAGE#<stage>` to `STATUS#<superStatus>`.
 * Idempotent: a deal already carrying `superStatus` is skipped. The legacy
 * `stage` field is left in place so historical timeline entries still resolve.
 *
 * Run once after deploying the super-status model.
 *
 * Usage:
 *   ts-node src/scripts/backfill-super-status.ts            # apply
 *   ts-node src/scripts/backfill-super-status.ts --dry-run  # preview only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  type DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { JobSuperStatus, STAGE_TO_SUPER_STATUS, type DealStage } from '@bitcrm/types';
import { docClient } from './seed-job-types';

export interface BackfillResult {
  migrated: number;
  skipped: number;
}

/** Map a legacy stage to its super-status, defaulting to Submitted. */
export function superStatusForStage(stage: unknown): JobSuperStatus {
  return STAGE_TO_SUPER_STATUS[stage as DealStage] ?? JobSuperStatus.SUBMITTED;
}

/**
 * Core, testable backfill. Scans DEAL#/METADATA rows, and for any without a
 * `superStatus` writes the derived value plus the re-keyed `GSI1PK`.
 */
export async function backfillSuperStatus(
  client: DynamoDBDocumentClient,
  table: string,
  opts: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  let migrated = 0;
  let skipped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'begins_with(PK, :deal) AND SK = :meta',
        ExpressionAttributeValues: { ':deal': 'DEAL#', ':meta': 'METADATA' },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      if (item.superStatus) { skipped++; continue; }
      const superStatus = superStatusForStage(item.stage);

      if (!opts.dryRun) {
        await client.send(
          new UpdateCommand({
            TableName: table,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET superStatus = :s, GSI1PK = :pk',
            ExpressionAttributeValues: {
              ':s': superStatus,
              ':pk': `STATUS#${superStatus}`,
            },
          }),
        );
      }
      migrated++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  return { migrated, skipped };
}

/* istanbul ignore next -- CLI entrypoint */
async function main(): Promise<void> {
  const table = process.env.DEALS_TABLE || 'BitCRM_Deals';
  const dryRun = process.argv.includes('--dry-run');
  const { migrated, skipped } = await backfillSuperStatus(docClient(), table, { dryRun });
  console.log(
    `\nBackfilled ${migrated} deal(s), skipped ${skipped} already-migrated${dryRun ? ' (dry-run)' : ''}.`,
  );
}

/* istanbul ignore next -- only runs as a CLI, never under test */
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill-super-status failed:', err);
      process.exit(1);
    });
}
