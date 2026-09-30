/**
 * Backfill: give every time-clock history item (`CLOCK#…`) its TimeClockIndex
 * (GSI6) keys, so the Timesheets report finds it.
 *
 * Who needs it: entries written by a user-service build from before the report
 * (the time clock shipped without the index). New entries get the keys at
 * clock-in; the Workiz import writes them itself. Running it on a table that
 * has none to fix changes nothing.
 *
 * It is a maintenance pass, so it Scans — once, filtered to `CLOCK#` rows that
 * lack GSI6PK, projecting only the key and the two attributes the keys are
 * made of. The report itself never scans. Each fix is a conditional
 * UpdateItem (the row must still exist and still lack the key), so a shift
 * closed or re-indexed meanwhile is left alone. Idempotent.
 *
 *   npm run db:backfill-timeclock-index -w backend/services/user -- --dry-run
 *   npm run db:backfill-timeclock-index -w backend/services/user
 *
 * Env: USERS_TABLE, AWS_REGION, optional DYNAMODB_ENDPOINT.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CLOCK_SK_PREFIX } from '../technicians/constants/dynamo.constants';
import { timeClockIndexKeys } from '../technicians/timeclock/timeclock-index';

const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region,
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
  );

  console.log(`Backfill TimeClockIndex (GSI6) — table=${USERS_TABLE} region=${region}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  let seen = 0;
  let fixed = 0;
  let skipped = 0;
  let unreadable = 0;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(SK, :clock) AND attribute_not_exists(GSI6PK)',
        ProjectionExpression: 'PK, SK, #id, startedAt',
        ExpressionAttributeNames: { '#id': 'id' },
        ExpressionAttributeValues: { ':clock': CLOCK_SK_PREFIX },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const row of page.Items || []) {
      seen++;
      let keys: { GSI6PK: string; GSI6SK: string };
      try {
        keys = timeClockIndexKeys({ id: row.id as string, startedAt: row.startedAt as string });
      } catch {
        unreadable++;
        console.warn(`  ! ${row.PK} / ${row.SK}: startedAt ${JSON.stringify(row.startedAt)} is not an instant`);
        continue;
      }
      if (DRY_RUN) {
        fixed++;
        continue;
      }
      try {
        await doc.send(
          new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { PK: row.PK, SK: row.SK },
            UpdateExpression: 'SET GSI6PK = :pk, GSI6SK = :sk',
            ConditionExpression: 'attribute_exists(SK) AND attribute_not_exists(GSI6PK)',
            ExpressionAttributeValues: { ':pk': keys.GSI6PK, ':sk': keys.GSI6SK },
          }),
        );
        fixed++;
      } catch (error) {
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
          skipped++;
          continue;
        }
        throw error;
      }
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);

  console.log(
    `\n${DRY_RUN ? 'Would index' : 'Indexed'} ${fixed} of ${seen} entries without GSI6` +
      (skipped ? `; ${skipped} changed meanwhile (left alone)` : '') +
      (unreadable ? `; ${unreadable} with an unreadable startedAt` : ''),
  );
}

main().catch((err) => {
  console.error('backfill-timeclock-index failed:', err);
  process.exit(1);
});
