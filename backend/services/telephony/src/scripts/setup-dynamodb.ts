import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CALLS_TABLE,
  CALLS_GSI1_NAME,
  CALLS_GSI2_NAME,
} from '../common/constants/dynamo.constants';

async function createCallsTable(client: DynamoDBClient) {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: CALLS_TABLE,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
          { AttributeName: 'GSI2PK', AttributeType: 'S' },
          { AttributeName: 'GSI2SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: CALLS_GSI1_NAME,
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: CALLS_GSI2_NAME,
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    console.log(`Table "${CALLS_TABLE}" created successfully`);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceInUseException') {
      console.log(`Table "${CALLS_TABLE}" already exists`);
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

  await createCallsTable(client);
}

main().catch((err) => {
  console.error('Failed to create tables:', err);
  process.exit(1);
});
