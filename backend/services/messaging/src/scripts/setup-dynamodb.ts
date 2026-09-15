import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  CreateTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { MESSAGING_TABLE } from '../common/constants/dynamo.constants';
import {
  messagingTableDefinition,
  messagingTableTtl,
} from '../common/messaging-table.schema';

/**
 * Creates the local messaging table with all six GSIs and TTL on `expiresAt`.
 * Idempotent: an existing table (or an already-enabled TTL) is reported, not
 * an error. Production tables are Terraform — this is for DynamoDB Local.
 */
async function createMessagingTable(client: DynamoDBClient) {
  try {
    await client.send(new CreateTableCommand(messagingTableDefinition(MESSAGING_TABLE)));
    console.log(`Table "${MESSAGING_TABLE}" created successfully`);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceInUseException') {
      console.log(`Table "${MESSAGING_TABLE}" already exists`);
    } else {
      throw error;
    }
  }

  try {
    await client.send(new UpdateTimeToLiveCommand(messagingTableTtl(MESSAGING_TABLE)));
    console.log(`TTL enabled on "${MESSAGING_TABLE}".expiresAt`);
  } catch (error: unknown) {
    // DynamoDB answers ValidationException when TTL is already enabled (or is
    // still being enabled from a previous run) — nothing to do in either case.
    if (error instanceof Error && error.name === 'ValidationException') {
      console.log(`TTL already enabled on "${MESSAGING_TABLE}"`);
    } else {
      throw error;
    }
  }
}

async function main() {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });

  await createMessagingTable(client);
}

main().catch((err) => {
  console.error('Failed to create table:', err);
  process.exit(1);
});
