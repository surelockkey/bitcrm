import {
  CreateTableCommand,
  DeleteItemCommand,
  DynamoDBClient,
  ScanCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  messagingTableDefinition,
  messagingTableTtl,
} from '../../src/common/messaging-table.schema';

/**
 * Integration harness: a throwaway table on the `dynamodb-test` container
 * (`docker compose --profile test up -d dynamodb-test`, port 8001).
 *
 *   npm run test:integration -w backend/services/messaging
 *   # or, from backend/: npm run test:integration   (scripts/test.sh)
 *
 * The table is built from the same definition the local setup script uses,
 * so a GSI added there is exercised here automatically.
 */
export const MESSAGING_TEST_TABLE = 'BitCRM_Messaging_Test';
const DYNAMODB_ENDPOINT = 'http://localhost:8001';

const rawClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

export function getTestDynamoDbClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
}

export async function createTestTables(): Promise<void> {
  try {
    await rawClient.send(new CreateTableCommand(messagingTableDefinition(MESSAGING_TEST_TABLE)));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ResourceInUseException') {
      // Table already exists
    } else {
      throw error;
    }
  }
  try {
    await rawClient.send(new UpdateTimeToLiveCommand(messagingTableTtl(MESSAGING_TEST_TABLE)));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ValidationException') {
      // TTL already enabled
    } else {
      throw error;
    }
  }
}

/** Test-only: a Scan is fine on a table that holds a handful of fixture rows. */
export async function clearTestTable(tableName: string): Promise<void> {
  const result = await rawClient.send(new ScanCommand({ TableName: tableName }));
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
