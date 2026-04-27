import {
  CreateTableCommand,
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const DEALS_TEST_TABLE = 'BitCRM_Deals_Test';
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

export async function createTestTables(): Promise<void> {
  try {
    await rawClient.send(
      new CreateTableCommand({
        TableName: DEALS_TEST_TABLE,
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

export function destroyRawClient(): void {
  rawClient.destroy();
}
