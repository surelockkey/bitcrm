import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { BILLING_GSIS, BILLING_TABLE } from '../common/constants/dynamo.constants';
import { billingTableDefinition, billingTableTtl } from '../common/billing-table.schema';

/**
 * Indexes added after the table first shipped. A local table created before
 * one of them existed gets it here (one per run — DynamoDB builds one index
 * at a time); a fresh table is created with all of them.
 */
const LATER_INDEXES = BILLING_GSIS.filter((g) => g.n >= 4);

/**
 * Creates the local billing table (PK/SK + ListIndex, ContactIndex,
 * DealIndex, UnpaidIndex) and enables TTL on `expiresAt` for the Stripe
 * webhook dedupe rows. Idempotent. Production is Terraform
 * (`infra/dev/data_plane.tf`).
 */
async function main() {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });
  try {
    await client.send(new CreateTableCommand(billingTableDefinition(BILLING_TABLE)));
    console.log(`Table "${BILLING_TABLE}" created successfully`);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceInUseException') {
      console.log(`Table "${BILLING_TABLE}" already exists`);
      await addLaterIndexes(client);
    } else {
      throw error;
    }
  }

  try {
    await client.send(new UpdateTimeToLiveCommand(billingTableTtl(BILLING_TABLE)));
    console.log(`TTL enabled on "${BILLING_TABLE}".expiresAt`);
  } catch (error: unknown) {
    // DynamoDB answers ValidationException when TTL is already enabled (or is
    // still being enabled from a previous run) — nothing to do in either case.
    if (error instanceof Error && error.name === 'ValidationException') {
      console.log(`TTL already enabled on "${BILLING_TABLE}"`);
    } else {
      throw error;
    }
  }
}

async function addLaterIndexes(client: DynamoDBClient): Promise<void> {
  const { Table } = await client.send(new DescribeTableCommand({ TableName: BILLING_TABLE }));
  const have = new Set((Table?.GlobalSecondaryIndexes ?? []).map((i) => i.IndexName));
  const missing = LATER_INDEXES.find((g) => !have.has(g.name));
  if (!missing) return;
  const pk = `GSI${missing.n}PK`;
  const sk = `GSI${missing.n}SK`;
  await client.send(
    new UpdateTableCommand({
      TableName: BILLING_TABLE,
      AttributeDefinitions: [
        { AttributeName: pk, AttributeType: 'S' },
        { AttributeName: sk, AttributeType: 'S' },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: missing.name,
            KeySchema: [
              { AttributeName: pk, KeyType: 'HASH' },
              { AttributeName: sk, KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        },
      ],
    }),
  );
  console.log(`Index "${missing.name}" added to "${BILLING_TABLE}" — run backfill:unpaid-index to fill it`);
}

main().catch((err) => {
  console.error('Failed to create table:', err);
  process.exit(1);
});
