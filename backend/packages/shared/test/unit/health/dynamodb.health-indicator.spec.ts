import { HealthCheckError } from '@nestjs/terminus';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DescribeTableCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { DynamoDbHealthIndicator } from '../../../src/health/dynamodb.health-indicator';

function makeIndicator(tables: string[]) {
  const dynamoDb = { client: { send: mockSend } } as never;
  return new DynamoDbHealthIndicator(dynamoDb, tables);
}

describe('DynamoDbHealthIndicator', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is healthy when every configured table can be described', async () => {
    mockSend.mockResolvedValue({ Table: { TableStatus: 'ACTIVE' } });
    const indicator = makeIndicator(['bitcrm-dev-users']);

    const result = await indicator.isHealthy('dynamodb');

    expect(result.dynamodb.status).toBe('up');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('throws HealthCheckError when a table cannot be described', async () => {
    mockSend.mockRejectedValue(new Error('AccessDeniedException'));
    const indicator = makeIndicator(['bitcrm-dev-users']);

    await expect(indicator.isHealthy('dynamodb')).rejects.toBeInstanceOf(
      HealthCheckError,
    );
  });
});
