import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';
import { planTestTechnicians } from './test-technicians.catalog';

/**
 * Seed 10 disposable Connecticut technicians (eligibility rows) so job
 * assignment can be tested across job types. Idempotent: deterministic ids
 * mean a rerun overwrites the same rows. Rows match the eligibility repository
 * shape (PK=TECH_ELIGIBILITY#<id>, SK=ELIGIBILITY).
 *
 * Run: DEALS_TABLE=<table> npx ts-node src/scripts/seed-test-technicians.ts
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
  const rows = planTestTechnicians();

  for (const e of rows) {
    await client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: {
          PK: `TECH_ELIGIBILITY#${e.technicianId}`,
          SK: 'ELIGIBILITY',
          ...e,
        },
      }),
    );
    console.log(`  + ${e.firstName} ${e.lastName} — ${e.jobTypeIds.length} job type(s)`);
  }
  console.log(`\nDone: ${rows.length} test technicians seeded in CT.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
