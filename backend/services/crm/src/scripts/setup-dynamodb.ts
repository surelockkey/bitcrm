import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  CreateTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

const CONTACTS_TABLE = 'BitCRM_Contacts';
const COMPANIES_TABLE = 'BitCRM_Companies';

async function createTable(
  client: DynamoDBClient,
  tableName: string,
  gsiIndexName: string,
) {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: gsiIndexName,
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    console.log(`Table "${tableName}" created successfully`);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ResourceInUseException'
    ) {
      console.log(`Table "${tableName}" already exists`);
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

  await createTable(client, CONTACTS_TABLE, 'CompanyIndex');
  await createTable(client, COMPANIES_TABLE, 'ClientTypeIndex');
}

main().catch((err) => {
  console.error('Failed to create tables:', err);
  process.exit(1);
});
