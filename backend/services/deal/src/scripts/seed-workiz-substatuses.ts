import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  JOB_STATUS_PK_PREFIX,
  JOB_STATUS_SK,
  JOB_STATUS_GSI1PK,
} from '../job-statuses/job-statuses.constants';
import { planWorkizSubStatusSeed } from './workiz-substatuses.catalog';

/**
 * Seed the sub-status catalog from the previous CRM. Idempotent: names that
 * already exist (case-insensitive) are skipped, and the conditional Put
 * refuses to overwrite an id. Items match the repository's shape exactly.
 *
 * Run: DEALS_TABLE=<table> npx ts-node src/scripts/seed-workiz-substatuses.ts
 */
async function main() {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ENDPOINT && {
        endpoint: process.env.AWS_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
  );

  console.log(`Table: ${DEALS_TABLE}\n`);

  const existing = await client.send(
    new QueryCommand({
      TableName: DEALS_TABLE,
      IndexName: DEALS_GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': JOB_STATUS_GSI1PK },
    }),
  );
  const existingNames = (existing.Items ?? []).map((i) => String(i.name));
  console.log(`Existing sub-statuses: ${existingNames.length}`);

  const plan = planWorkizSubStatusSeed(existingNames);
  if (plan.length === 0) {
    console.log('Nothing to create — catalog already seeded.');
    return;
  }

  for (const status of plan) {
    await client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: {
          PK: `${JOB_STATUS_PK_PREFIX}${status.id}`,
          SK: JOB_STATUS_SK,
          GSI1PK: JOB_STATUS_GSI1PK,
          GSI1SK: `${status.group}#${String(status.priority).padStart(6, '0')}#${status.name.toLowerCase()}`,
          ...status,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    console.log(`  + ${status.group} / ${status.name}`);
  }
  console.log(`\nDone: ${plan.length} sub-statuses created.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
