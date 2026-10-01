import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb';

/**
 * Indexes added after the table first shipped. A local table created before
 * one of them existed gets it here (one per run — DynamoDB builds one index
 * at a time); a fresh table is created with all of them.
 */
const LATER_INDEXES = [
  { name: 'EndIndex', pk: 'GSI7PK', sk: 'GSI7SK', backfill: 'backfill:end-index' },
  { name: 'ContactActivityIndex', pk: 'GSI10PK', sk: 'GSI10SK', backfill: 'backfill:contact-index' },
];

const TABLE_NAME = 'BitCRM_Deals';

async function main() {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });

  try {
    await client.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
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
          { AttributeName: 'GSI3PK', AttributeType: 'S' },
          { AttributeName: 'GSI3SK', AttributeType: 'S' },
          { AttributeName: 'GSI4PK', AttributeType: 'S' },
          { AttributeName: 'GSI4SK', AttributeType: 'S' },
          { AttributeName: 'GSI5PK', AttributeType: 'S' },
          { AttributeName: 'GSI5SK', AttributeType: 'S' },
          { AttributeName: 'GSI6PK', AttributeType: 'S' },
          { AttributeName: 'GSI6SK', AttributeType: 'S' },
          { AttributeName: 'GSI7PK', AttributeType: 'S' },
          { AttributeName: 'GSI7SK', AttributeType: 'S' },
          { AttributeName: 'GSI10PK', AttributeType: 'S' },
          { AttributeName: 'GSI10SK', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'StageIndex',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'TechIndex',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'ContactIndex',
            KeySchema: [
              { AttributeName: 'GSI3PK', KeyType: 'HASH' },
              { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'DispatcherIndex',
            KeySchema: [
              { AttributeName: 'GSI4PK', KeyType: 'HASH' },
              { AttributeName: 'GSI4SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'StatusScheduleIndex',
            KeySchema: [
              { AttributeName: 'GSI5PK', KeyType: 'HASH' },
              { AttributeName: 'GSI5SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'ClosedIndex',
            KeySchema: [
              { AttributeName: 'GSI6PK', KeyType: 'HASH' },
              { AttributeName: 'GSI6SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            // The visit's end on the account's clock — the Jobs report's "By: Job end date".
            IndexName: 'EndIndex',
            KeySchema: [
              { AttributeName: 'GSI7PK', KeyType: 'HASH' },
              { AttributeName: 'GSI7SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            // The client card's History and Files: CONTACT#<contactId> on the
            // timeline rows, CONTACTFILE#<contactId> on the attachment rows
            // (`contacts/contact-index.ts`). 8 and 9 are the Activity report's
            // (`setup:activity-indexes`).
            IndexName: 'ContactActivityIndex',
            KeySchema: [
              { AttributeName: 'GSI10PK', KeyType: 'HASH' },
              { AttributeName: 'GSI10SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    console.log(`Table "${TABLE_NAME}" created successfully`);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ResourceInUseException'
    ) {
      console.log(`Table "${TABLE_NAME}" already exists`);
      await addLaterIndexes(client);
    } else {
      throw error;
    }
  }
}

async function addLaterIndexes(client: DynamoDBClient): Promise<void> {
  const { Table } = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
  const have = new Set((Table?.GlobalSecondaryIndexes ?? []).map((i) => i.IndexName));
  const missing = LATER_INDEXES.find((i) => !have.has(i.name));
  if (!missing) return;
  await client.send(
    new UpdateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        { AttributeName: missing.pk, AttributeType: 'S' },
        { AttributeName: missing.sk, AttributeType: 'S' },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: missing.name,
            KeySchema: [
              { AttributeName: missing.pk, KeyType: 'HASH' },
              { AttributeName: missing.sk, KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        },
      ],
    }),
  );
  console.log(`Index "${missing.name}" added to "${TABLE_NAME}" — run ${missing.backfill} to fill it`);
}

main().catch((err) => {
  console.error('Failed to create table:', err);
  process.exit(1);
});
