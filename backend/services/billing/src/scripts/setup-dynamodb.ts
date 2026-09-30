import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { CreateTableCommand, DynamoDBClient, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import { BILLING_TABLE } from '../common/constants/dynamo.constants';
import { billingTableDefinition, billingTableTtl } from '../common/billing-table.schema';

/**
 * Creates the local billing table (PK/SK + ListIndex, ContactIndex,
 * DealIndex) and enables TTL on `expiresAt` for the Stripe webhook dedupe
 * rows. Idempotent. Production is Terraform (`infra/dev/data_plane.tf`).
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

main().catch((err) => {
  console.error('Failed to create table:', err);
  process.exit(1);
});
