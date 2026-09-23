/**
 * The call log is keyed by the month it happened in, not by one constant
 * (`CALL#ALL`). 1.8 M Workiz calls all share one partition key otherwise:
 * a single partition takes at most 1 000 writes a second, which would
 * throttle the import for hours, and every read of the log — the page, the
 * live strip, every filter — queues behind that same partition.
 *
 * Months are strictly ordered, so the log is walked newest month first and
 * the cursor says which month it stopped in.
 */
import { DynamoDbService } from '@bitcrm/shared';
import { CallsRepository } from '../../src/calls/calls.repository';
import { allCallsPk, monthsDescending } from '../../src/common/constants/dynamo.constants';

/** The Dynamo client is mocked; what is asserted is the QueryCommand input. */
function createMockDynamoDbService() {
  return { client: { send: jest.fn() } };
}
const repoOf = (m: ReturnType<typeof createMockDynamoDbService>) =>
  new CallsRepository(m as unknown as DynamoDbService);

describe('allCallsPk', () => {
  it('keys a call on the month it started in', () => {
    expect(allCallsPk('2026-09-23T14:05:00.000Z')).toBe('CALL#2026-09');
    expect(allCallsPk('2018-01-01T00:00:00.000Z')).toBe('CALL#2018-01');
  });
});

describe('monthsDescending', () => {
  it('walks a window newest month first, both ends included', () => {
    expect(monthsDescending('2026-07-20T00:00:00.000Z', '2026-09-02T00:00:00.000Z')).toEqual([
      '2026-09',
      '2026-08',
      '2026-07',
    ]);
  });

  it('one month is one partition', () => {
    expect(monthsDescending('2026-09-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z')).toEqual(['2026-09']);
  });

  it('with no lower bound it stops at the first month the log can hold', () => {
    const months = monthsDescending(undefined, '2026-09-30T00:00:00.000Z');
    expect(months[0]).toBe('2026-09');
    expect(months[months.length - 1]).toBe('2015-01');
  });

  it('a window running backwards is empty rather than endless', () => {
    expect(monthsDescending('2026-09-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')).toEqual([]);
  });
});

describe('CallsRepository — writing the month key', () => {
  it('upsert keys the call on its own month', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = repoOf(dynamoDb);
    dynamoDb.client.send.mockResolvedValue({});
    await repository.upsert({
      callSid: 'CA1',
      startedAt: '2026-09-23T14:05:00.000Z',
      updatedAt: '2026-09-23T14:06:00.000Z',
    } as never);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues[':gsi2pk']).toBe('CALL#2026-09');
  });
});

describe('CallsRepository.list — a walk across months', () => {
  const call = (sid: string, at: string) => ({
    PK: `CALL#${sid}`,
    SK: 'METADATA',
    GSI2PK: `CALL#${at.slice(0, 7)}`,
    GSI2SK: `${at}#${sid}`,
    callSid: sid,
    startedAt: at,
    updatedAt: at,
  });

  it('a date window reads only the months it touches, newest first', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = repoOf(dynamoDb);
    const asked: string[] = [];
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      asked.push(cmd.input.ExpressionAttributeValues[':allPk']);
      return { Items: [] };
    });

    await repository.list(
      { dateFrom: '2026-07-20T00:00:00.000Z', dateTo: '2026-09-02T00:00:00.000Z' } as never,
      undefined,
      50,
    );

    expect(asked).toEqual(['CALL#2026-09', 'CALL#2026-08', 'CALL#2026-07']);
  });

  it('a full page stops in the month it filled up, and the cursor says so', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = repoOf(dynamoDb);
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':allPk'] as string;
      if (pk !== 'CALL#2026-09') return { Items: [] };
      return {
        Items: [call('CA1', '2026-09-20T10:00:00.000Z'), call('CA2', '2026-09-19T10:00:00.000Z')],
        LastEvaluatedKey: { PK: 'CALL#CA2' },
      };
    });

    const page = await repository.list(
      { dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-09-30T00:00:00.000Z' } as never,
      undefined,
      2,
    );

    expect(page.items.map((c) => c.callSid)).toEqual(['CA1', 'CA2']);
    expect(page.nextCursor).toBeDefined();
    const resumed = JSON.parse(Buffer.from(page.nextCursor as string, 'base64url').toString());
    expect(resumed.month).toBe('2026-09');
  });

  it('a cursor resumes inside its month and then carries on into the earlier ones', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = repoOf(dynamoDb);
    const asked: { pk: string; from?: Record<string, unknown> }[] = [];
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      asked.push({ pk: cmd.input.ExpressionAttributeValues[':allPk'], from: cmd.input.ExclusiveStartKey });
      return { Items: [] };
    });

    const cursor = Buffer.from(JSON.stringify({ month: '2026-08', key: { PK: 'CALL#CA9' } })).toString('base64url');
    await repository.list(
      { dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-09-30T00:00:00.000Z' } as never,
      cursor,
      50,
    );

    expect(asked.map((a) => a.pk)).toEqual(['CALL#2026-08', 'CALL#2026-07']);
    expect(asked[0].from).toEqual({ PK: 'CALL#CA9' });
    expect(asked[1].from).toBeUndefined();
  });

  it('a filter that matches nothing stops after a bounded number of queries', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = repoOf(dynamoDb);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    const page = await repository.list({ status: 'no-such-status' } as never, undefined, 50);

    expect(page.items).toEqual([]);
    // Bounded: the log reaches back to 2015, and a full walk would be ~130
    // queries in one request.
    expect(dynamoDb.client.send.mock.calls.length).toBeLessThanOrEqual(20);
    expect(page.nextCursor).toBeDefined();
  });

  it('the live strip reads the months its window touches', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = repoOf(dynamoDb);
    const asked: string[] = [];
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      asked.push(cmd.input.ExpressionAttributeValues[':allPk']);
      return { Items: [] };
    });

    // A few minutes past midnight on the 1st: the window reaches back into
    // the previous month, and a call from yesterday is still live.
    await repository.listLive(Date.parse('2026-09-01T00:05:00.000Z'));

    expect(asked).toContain('CALL#2026-09');
    expect(asked).toContain('CALL#2026-08');
  });
});
