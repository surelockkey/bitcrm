/**
 * Stamp the StatusScheduleIndex keys onto every deal METADATA row.
 *
 * WHY
 * ---
 * GSI5 (`STATUS#<superStatus>` / `<scheduledDate|UNSCHED>#<slotStart|~>#DEAL#<id>`)
 * is how the jobs list, the board and the schedule read a window of visit
 * days instead of the whole table. The repository writes the keys on every
 * create and on every scheduling / status update; rows written before the
 * index existed have none, and a row without both keys is simply absent from
 * the index — it would vanish from every schedule-ordered list.
 *
 * WHAT
 * ----
 * Scans METADATA rows, computes the keys with the same `statusScheduleKeys`
 * the repository uses, and writes only the rows whose stored keys differ.
 * Idempotent and upsert-only, as backfills must be (backend/CLAUDE.md §5).
 * The Workiz importer writes the keys itself, so a freshly imported table
 * reports every row as already correct.
 *
 * USAGE
 * -----
 *   npm run backfill:status-schedule-index -w backend/services/deal            # dry run
 *   npm run backfill:status-schedule-index -w backend/services/deal -- --apply
 *
 * Needs the index to exist first: Terraform (`infra/dev/data_plane.tf`) or
 * `setup-dynamodb.ts` locally. It writes attributes either way, but without
 * the index they are just attributes.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { STAGE_TO_SUPER_STATUS, JobSuperStatus, type DealStage } from '@bitcrm/types';
import { statusScheduleKeys } from '../deals/deals.repository';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
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

async function main(): Promise<void> {
  console.log(`Table: ${TABLE}`);
  console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  let scanned = 0;
  let stamped = 0;
  let skipped = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'SK = :meta AND begins_with(PK, :deal)',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':deal': 'DEAL#' },
        ProjectionExpression: 'PK, SK, id, superStatus, stage, scheduledDate, scheduledTimeSlot, allDay, GSI5PK, GSI5SK, slotStart',
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of page.Items ?? []) {
      scanned += 1;
      const superStatus =
        (item.superStatus as JobSuperStatus | undefined) ??
        STAGE_TO_SUPER_STATUS[item.stage as DealStage] ??
        JobSuperStatus.SUBMITTED;
      const keys = statusScheduleKeys({
        id: item.id as string,
        superStatus,
        scheduledDate: item.scheduledDate as string | undefined,
        scheduledTimeSlot: item.scheduledTimeSlot as string | undefined,
        allDay: item.allDay as boolean | undefined,
      });
      const current = { GSI5PK: item.GSI5PK, GSI5SK: item.GSI5SK, slotStart: item.slotStart };
      if (current.GSI5PK === keys.GSI5PK && current.GSI5SK === keys.GSI5SK && current.slotStart === keys.slotStart) {
        skipped += 1;
        continue;
      }
      stamped += 1;
      console.log(`${APPLY ? 'stamp' : 'would stamp'} ${item.PK}: ${keys.GSI5SK}`);
      if (!APPLY) continue;
      await client.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: keys.slotStart
            ? 'SET GSI5PK = :pk, GSI5SK = :sk, #slotStart = :slotStart'
            : 'SET GSI5PK = :pk, GSI5SK = :sk REMOVE #slotStart',
          ExpressionAttributeNames: { '#slotStart': 'slotStart' },
          ExpressionAttributeValues: {
            ':pk': keys.GSI5PK,
            ':sk': keys.GSI5SK,
            ...(keys.slotStart ? { ':slotStart': keys.slotStart } : {}),
          },
          ConditionExpression: 'attribute_exists(PK)',
        }),
      );
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  console.log(`\nScanned ${scanned} deals: ${stamped} ${APPLY ? 'stamped' : 'to stamp'}, ${skipped} already correct.`);
}

main().catch((err) => {
  console.error('backfill-status-schedule-index failed:', err);
  process.exit(1);
});
