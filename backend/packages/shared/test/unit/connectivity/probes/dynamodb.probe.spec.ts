import { DynamoDbProbe } from '../../../../src/connectivity/probes/dynamodb.probe';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  DescribeTableCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

describe('DynamoDbProbe', () => {
  let client: DynamoDBClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new DynamoDBClient({});
  });

  it('returns ok when all required tables are ACTIVE', async () => {
    mockSend.mockResolvedValue({ Table: { TableStatus: 'ACTIVE' } });
    const probe = new DynamoDbProbe(client, ['bitcrm-dev-users', 'bitcrm-dev-roles']);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([
      { resource: 'bitcrm-dev-users', present: true },
      { resource: 'bitcrm-dev-roles', present: true },
    ]);
    expect(out.message).toContain('2/2');
    // one DescribeTable per required table, no account-wide list
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns ok=false and flags a missing table', async () => {
    mockSend
      .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } })
      .mockRejectedValueOnce(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      );
    const probe = new DynamoDbProbe(client, ['bitcrm-dev-users', 'bitcrm-dev-roles']);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: 'bitcrm-dev-users', present: true },
      {
        resource: 'bitcrm-dev-roles',
        present: false,
        details: 'ResourceNotFoundException',
      },
    ]);
  });

  it('treats a non-ACTIVE table as not present', async () => {
    mockSend.mockResolvedValue({ Table: { TableStatus: 'CREATING' } });
    const probe = new DynamoDbProbe(client, ['bitcrm-dev-users']);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: 'bitcrm-dev-users', present: false, details: 'CREATING' },
    ]);
  });

  it('returns ok=true with no required tables configured', async () => {
    const probe = new DynamoDbProbe(client);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
