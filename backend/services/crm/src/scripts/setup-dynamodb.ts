import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
  type AttributeDefinition,
  type GlobalSecondaryIndex,
} from '@aws-sdk/client-dynamodb';

const CONTACTS_TABLE = 'BitCRM_Contacts';
const COMPANIES_TABLE = 'BitCRM_Companies';

/**
 * Indexes beyond CompanyIndex, per table. Created with a new table, and added
 * to an existing local table by UpdateTable (one per run — DynamoDB builds
 * one GSI at a time), with the backfill that fills it named.
 */
const LATER_INDEXES: Record<string, { name: string; pk: string; sk: string; backfill: string }[]> = {
  [CONTACTS_TABLE]: [
    // Sparse: CONTACTS#ACTIVE / <name>#<id> on active contacts — the client
    // list A→Z without a Scan (`contacts/contact-list-index.ts`).
    { name: 'ContactListIndex', pk: 'GSI2PK', sk: 'GSI2SK', backfill: 'backfill:contact-list-index -- --apply' },
  ],
};

function laterIndexParts(tableName: string): { attrs: AttributeDefinition[]; gsis: GlobalSecondaryIndex[] } {
  const later = LATER_INDEXES[tableName] ?? [];
  return {
    attrs: later.flatMap((i) => [
      { AttributeName: i.pk, AttributeType: 'S' as const },
      { AttributeName: i.sk, AttributeType: 'S' as const },
    ]),
    gsis: later.map((i) => ({
      IndexName: i.name,
      KeySchema: [
        { AttributeName: i.pk, KeyType: 'HASH' as const },
        { AttributeName: i.sk, KeyType: 'RANGE' as const },
      ],
      Projection: { ProjectionType: 'ALL' as const },
    })),
  };
}

async function addLaterIndexes(client: DynamoDBClient, tableName: string): Promise<void> {
  const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const have = new Set((Table?.GlobalSecondaryIndexes ?? []).map((i) => i.IndexName));
  const missing = (LATER_INDEXES[tableName] ?? []).find((i) => !have.has(i.name));
  if (!missing) return;
  await client.send(
    new UpdateTableCommand({
      TableName: tableName,
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
  console.log(`Index "${missing.name}" added to "${tableName}" — run ${missing.backfill} to fill it`);
}

async function createTable(
  client: DynamoDBClient,
  tableName: string,
  gsiIndexName: string,
) {
  const later = laterIndexParts(tableName);
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
          ...later.attrs,
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
          ...later.gsis,
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
      await addLaterIndexes(client, tableName);
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
