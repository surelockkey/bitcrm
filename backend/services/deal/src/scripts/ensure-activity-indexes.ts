/**
 * Add the Activity report's two indexes to a LOCAL deals table.
 *
 * Deployed tables get them from Terraform (`infra/dev/data_plane.tf`). A local
 * table made by `setup:db` before they existed gets them here — one per run
 * of UpdateTable (DynamoDB builds one index at a time), waiting for each.
 *
 *   npm run setup:activity-indexes -w backend/services/deal
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DescribeTableCommand, DynamoDBClient, UpdateTableCommand } from '@aws-sdk/client-dynamodb';
import { ACTIVITY_ACTOR_INDEX, ACTIVITY_DAY_INDEX } from '../activity/activity.constants';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const INDEXES = [
  { name: ACTIVITY_DAY_INDEX, pk: 'GSI8PK', sk: 'GSI8SK' },
  { name: ACTIVITY_ACTOR_INDEX, pk: 'GSI9PK', sk: 'GSI9SK' },
];

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.DYNAMODB_ENDPOINT && {
    endpoint: process.env.DYNAMODB_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitActive(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: TABLE }));
    const busy = (Table?.GlobalSecondaryIndexes ?? []).some((g) => g.IndexStatus !== 'ACTIVE');
    if (Table?.TableStatus === 'ACTIVE' && !busy) return;
    await sleep(2000);
  }
  throw new Error(`${TABLE} did not settle`);
}

async function main(): Promise<void> {
  for (const index of INDEXES) {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: TABLE }));
    if ((Table?.GlobalSecondaryIndexes ?? []).some((g) => g.IndexName === index.name)) {
      console.log(`${index.name}: already there`);
      continue;
    }
    await client.send(
      new UpdateTableCommand({
        TableName: TABLE,
        AttributeDefinitions: [
          { AttributeName: index.pk, AttributeType: 'S' },
          { AttributeName: index.sk, AttributeType: 'S' },
        ],
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: index.name,
              KeySchema: [
                { AttributeName: index.pk, KeyType: 'HASH' },
                { AttributeName: index.sk, KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          },
        ],
      }),
    );
    console.log(`${index.name}: creating…`);
    await waitActive();
    console.log(`${index.name}: active`);
  }
  console.log('\nNow: npm run backfill:activity-index -w backend/services/deal -- --apply, then recount:activity -- --apply');
}

main().catch((err) => {
  console.error('ensure-activity-indexes failed:', err);
  process.exit(1);
});
