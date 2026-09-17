import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BILLING_TABLE } from '../common/constants/dynamo.constants';
import { billingTableDefinition } from '../common/billing-table.schema';

/**
 * Creates the local billing table (PK/SK + ListIndex, ContactIndex,
 * DealIndex). Idempotent. Production is Terraform (`infra/dev/data_plane.tf`).
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
}

main().catch((err) => {
  console.error('Failed to create table:', err);
  process.exit(1);
});
