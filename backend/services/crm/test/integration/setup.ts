import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const CONTACTS_TEST_TABLE = 'BitCRM_Contacts_Test';
export const COMPANIES_TEST_TABLE = 'BitCRM_Companies_Test';
const DYNAMODB_ENDPOINT = 'http://localhost:8001';

const rawClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

export function getTestDynamoDbClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

async function createCrmTable(tableName: string, gsiName: string, withListIndex = false): Promise<void> {
  try {
    await rawClient.send(
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
          ...(withListIndex
            ? [
                { AttributeName: 'GSI2PK', AttributeType: 'S' as const },
                { AttributeName: 'GSI2SK', AttributeType: 'S' as const },
              ]
            : []),
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: gsiName,
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          // ContactListIndex — the client list (contacts/contact-list-index.ts).
          ...(withListIndex
            ? [
                {
                  IndexName: 'ContactListIndex',
                  KeySchema: [
                    { AttributeName: 'GSI2PK', KeyType: 'HASH' as const },
                    { AttributeName: 'GSI2SK', KeyType: 'RANGE' as const },
                  ],
                  Projection: { ProjectionType: 'ALL' as const },
                },
              ]
            : []),
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceInUseException') {
      // Table already exists
    } else {
      throw error;
    }
  }
}

export async function createTestTables(): Promise<void> {
  await createCrmTable(CONTACTS_TEST_TABLE, 'CompanyIndex', true);
  await createCrmTable(COMPANIES_TEST_TABLE, 'ClientTypeIndex');
}

export async function clearTestTable(tableName: string): Promise<void> {
  const result = await rawClient.send(
    new ScanCommand({ TableName: tableName }),
  );

  if (result.Items) {
    for (const item of result.Items) {
      await rawClient.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: { PK: item.PK!, SK: item.SK! },
        }),
      );
    }
  }
}

export async function deleteTestTable(tableName: string): Promise<void> {
  try {
    await rawClient.send(new DeleteTableCommand({ TableName: tableName }));
  } catch {
    // Ignore
  }
}

export function destroyRawClient(): void {
  rawClient.destroy();
}
