import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  EXTERNAL_COMPANY_PK_PREFIX,
  EXTERNAL_COMPANY_SK,
  EXTERNAL_COMPANY_GSI1PK,
} from '../external-companies/external-companies.constants';
import { planExternalCompanySeed } from './external-companies.catalog';

/**
 * Seed the external-company catalog from the previous CRM. Idempotent: names
 * that already exist (case-insensitive) are skipped, and the conditional Put
 * refuses to overwrite an id. Items match the repository's shape exactly.
 *
 * Run: DEALS_TABLE=<table> npm run seed:external-companies
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
    { marshallOptions: { removeUndefinedValues: true } },
  );

  console.log(`Table: ${DEALS_TABLE}\n`);

  const existing = await client.send(
    new QueryCommand({
      TableName: DEALS_TABLE,
      IndexName: DEALS_GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': EXTERNAL_COMPANY_GSI1PK },
    }),
  );
  const existingNames = (existing.Items ?? []).map((i) => String(i.name));
  console.log(`Existing external companies: ${existingNames.length}`);

  const plan = planExternalCompanySeed(existingNames);
  if (plan.length === 0) {
    console.log('Nothing to create — catalog already seeded.');
    return;
  }

  for (const company of plan) {
    await client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: {
          PK: `${EXTERNAL_COMPANY_PK_PREFIX}${company.id}`,
          SK: EXTERNAL_COMPANY_SK,
          GSI1PK: EXTERNAL_COMPANY_GSI1PK,
          GSI1SK: company.name.toLowerCase(),
          ...company,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    console.log(`  + ${company.name}${company.active ? '' : ' (disabled)'}`);
  }

  console.log(`\nCreated ${plan.length} external companies.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed-external-companies failed:', err);
    process.exit(1);
  });
