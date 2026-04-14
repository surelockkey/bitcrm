import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';

export const TEST_TABLE = 'BitCRM_Users_Test';
const DYNAMODB_ENDPOINT = 'http://localhost:8001';
const REDIS_URL = 'redis://localhost:6379';

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

export function getTestRedisClient(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
}

export async function createTestTable(): Promise<void> {
  try {
    await rawClient.send(
      new CreateTableCommand({
        TableName: TEST_TABLE,
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
            IndexName: 'RoleIndex',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'DepartmentIndex',
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
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceInUseException') {
      // Table already exists
    } else {
      throw error;
    }
  }
}

export async function deleteTestTable(): Promise<void> {
  try {
    await rawClient.send(new DeleteTableCommand({ TableName: TEST_TABLE }));
  } catch {
    // Ignore
  }
}

export async function clearTestTable(): Promise<void> {
  const result = await rawClient.send(
    new ScanCommand({ TableName: TEST_TABLE }),
  );

  if (result.Items) {
    for (const item of result.Items) {
      await rawClient.send(
        new DeleteItemCommand({
          TableName: TEST_TABLE,
          Key: { PK: item.PK!, SK: item.SK! },
        }),
      );
    }
  }
}

export function destroyRawClient(): void {
  rawClient.destroy();
}
