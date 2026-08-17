import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  CUSTOM_FIELD_PK_PREFIX,
  CUSTOM_FIELD_SK,
  CUSTOM_FIELD_GSI1PK,
} from '../custom-fields/custom-fields.constants';
import { planWorkizSeed } from './workiz-fields.catalog';

/**
 * Seed the Workiz custom-field catalog. Idempotent: fields whose name already
 * exists (case-insensitive) are skipped, and the conditional Put refuses to
 * overwrite an id. Items are written in exactly the repository's shape.
 *
 * Run: DEALS_TABLE=<table> npx ts-node src/scripts/seed-workiz-fields.ts
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
      ExpressionAttributeValues: { ':pk': CUSTOM_FIELD_GSI1PK },
    }),
  );
  const existingNames = (existing.Items ?? []).map((i) => String(i.name));
  console.log(`Existing custom fields: ${existingNames.length}`);

  const plan = planWorkizSeed(existingNames);
  if (plan.length === 0) {
    console.log('Nothing to create — catalog already seeded.');
    return;
  }

  for (const field of plan) {
    await client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: {
          PK: `${CUSTOM_FIELD_PK_PREFIX}${field.id}`,
          SK: CUSTOM_FIELD_SK,
          GSI1PK: CUSTOM_FIELD_GSI1PK,
          GSI1SK: `${String(field.priority).padStart(6, '0')}#${field.name.toLowerCase()}`,
          ...field,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    console.log(`  + ${field.group} / ${field.name} (${field.type})`);
  }
  console.log(`\nDone: ${plan.length} fields created.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
