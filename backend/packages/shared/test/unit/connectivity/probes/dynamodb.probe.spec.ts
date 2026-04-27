import { DynamoDbProbe } from '../../../../src/connectivity/probes/dynamodb.probe';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  ListTablesCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

describe('DynamoDbProbe', () => {
  let client: DynamoDBClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new DynamoDBClient({});
  });

  it('returns ok when all required tables exist', async () => {
    mockSend.mockResolvedValueOnce({
      TableNames: ['BitCRM_Users', 'BitCRM_Roles', 'extra'],
    });
    const probe = new DynamoDbProbe(client, ['BitCRM_Users', 'BitCRM_Roles']);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([
      { resource: 'BitCRM_Users', present: true },
      { resource: 'BitCRM_Roles', present: true },
    ]);
    expect(out.message).toContain('3 tables');
  });

  it('returns ok=false and lists missing tables', async () => {
    mockSend.mockResolvedValueOnce({ TableNames: ['BitCRM_Users'] });
    const probe = new DynamoDbProbe(client, ['BitCRM_Users', 'BitCRM_Roles']);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: 'BitCRM_Users', present: true },
      { resource: 'BitCRM_Roles', present: false },
    ]);
  });

  it('paginates ListTables', async () => {
    mockSend
      .mockResolvedValueOnce({
        TableNames: ['t1'],
        LastEvaluatedTableName: 't1',
      })
      .mockResolvedValueOnce({ TableNames: ['t2'] });
    const probe = new DynamoDbProbe(client, ['t2']);

    const out = await probe.run();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
  });

  it('returns ok=true with no required tables when listing succeeds', async () => {
    mockSend.mockResolvedValueOnce({ TableNames: ['x'] });
    const probe = new DynamoDbProbe(client);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([]);
  });
});
