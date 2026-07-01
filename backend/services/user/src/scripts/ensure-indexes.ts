/**
 * Schema migration: ensure the users table has all required GSIs, adding any
 * that are missing via online UpdateTable (one at a time, waiting for ACTIVE).
 * Idempotent — safe to run repeatedly.
 *
 * In PRODUCTION the table schema is owned by Terraform (infra/dev/data_plane.tf);
 * `terraform apply` adds new GSIs declaratively as part of the deploy pipeline.
 * This script is the equivalent for LOCAL/dev DynamoDB (and an emergency manual
 * path) since setup-dynamodb.ts only creates the table, never alters it.
 *
 *   ts-node src/scripts/ensure-indexes.ts
 *
 * Env: USERS_TABLE, AWS_REGION, optional DYNAMODB_ENDPOINT (local).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  DynamoDBClient,
  DescribeTableCommand,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb';

const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';

// name -> GSI number (attributes are GSI<n>PK / GSI<n>SK)
const REQUIRED_GSIS: Array<{ name: string; n: number }> = [
  { name: 'RoleIndex', n: 1 },
  { name: 'DepartmentIndex', n: 2 },
  { name: 'TechnicianIndex', n: 3 },
  { name: 'SkillStatusIndex', n: 4 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitActive(client: DynamoDBClient): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const { Table } = await client.send(
      new DescribeTableCommand({ TableName: USERS_TABLE }),
    );
    const gsiStatuses = (Table?.GlobalSecondaryIndexes || []).map(
      (g) => g.IndexStatus,
    );
    if (Table?.TableStatus === 'ACTIVE' && gsiStatuses.every((s) => s === 'ACTIVE')) {
      return;
    }
    await sleep(2000);
  }
  throw new Error('Timed out waiting for table/indexes to become ACTIVE');
}

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new DynamoDBClient({
    region,
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });

  console.log(`Ensure GSIs — table=${USERS_TABLE} region=${region}\n`);

  for (const gsi of REQUIRED_GSIS) {
    const { Table } = await client.send(
      new DescribeTableCommand({ TableName: USERS_TABLE }),
    );
    const existing = new Set(
      (Table?.GlobalSecondaryIndexes || []).map((g) => g.IndexName),
    );
    if (existing.has(gsi.name)) {
      console.log(`  = ${gsi.name}: present`);
      continue;
    }

    console.log(`  + ${gsi.name}: creating (online UpdateTable)…`);
    await client.send(
      new UpdateTableCommand({
        TableName: USERS_TABLE,
        AttributeDefinitions: [
          { AttributeName: `GSI${gsi.n}PK`, AttributeType: 'S' },
          { AttributeName: `GSI${gsi.n}SK`, AttributeType: 'S' },
        ],
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              IndexName: gsi.name,
              KeySchema: [
                { AttributeName: `GSI${gsi.n}PK`, KeyType: 'HASH' },
                { AttributeName: `GSI${gsi.n}SK`, KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          },
        ],
      }),
    );
    await waitActive(client);
    console.log(`    ${gsi.name}: ACTIVE`);
  }

  console.log('\nDone. All required GSIs present.');
}

main().catch((err) => {
  console.error('ensure-indexes failed:', err);
  process.exit(1);
});
