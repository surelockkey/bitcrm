import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { DynamoDbService } from '@bitcrm/shared';
import { billingTableDefinition } from '../../src/common/billing-table.schema';

/**
 * Integration harness: a throwaway table on the `dynamodb-test` container
 * (`docker compose --profile test up -d dynamodb-test`, port 8001), built
 * from the same definition the local setup script uses.
 *
 *   npm run test:integration -w billing-service
 */
export const BILLING_TEST_TABLE = 'BitCRM_Billing_Test';

const rawClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8001',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

export function testDynamo(): DynamoDbService {
  const client = DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
  return { client } as unknown as DynamoDbService;
}

export async function resetTable(): Promise<void> {
  await rawClient.send(new DeleteTableCommand({ TableName: BILLING_TEST_TABLE })).catch(() => undefined);
  await rawClient.send(new CreateTableCommand(billingTableDefinition(BILLING_TEST_TABLE)));
}

export function destroyRawClient(): void {
  rawClient.destroy();
}
