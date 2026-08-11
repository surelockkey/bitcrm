import { DynamoDbService } from '@bitcrm/shared';
import {
  CallsRepository,
  type CallRecord,
  type ListCallsFilter,
} from '../../src/calls/calls.repository';

/**
 * Unit coverage for the global-list query assembly (GSI2), the in-service
 * filter loop, and cursor round-tripping. The Dynamo client is mocked; what we
 * assert is the exact QueryCommand input the repository builds and how it
 * pages/aggregates. Real Dynamo behaviour is covered by the integration spec.
 */

type SentCommand = { input: Record<string, any> };

function makeRepo(pages: Array<{ Items: any[]; LastEvaluatedKey?: any }>) {
  const sent: SentCommand[] = [];
  let page = 0;
  const client = {
    send: jest.fn(async (cmd: SentCommand) => {
      sent.push(cmd);
      const res = pages[Math.min(page, pages.length - 1)] ?? { Items: [] };
      page += 1;
      return res;
    }),
  };
  const repo = new CallsRepository({ client } as unknown as DynamoDbService);
  return { repo, sent };
}

const item = (sid: string, over: Partial<CallRecord> = {}) => ({
  callSid: sid,
  status: 'completed',
  direction: 'outbound',
  from: '+15412830739',
  to: '+14045551234',
  startedAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:01:00.000Z',
  ...over,
});

describe('CallsRepository.list (GSI2 query assembly)', () => {
  it('queries the all-calls index newest-first with the partition key', async () => {
    const { repo, sent } = makeRepo([{ Items: [item('CA1')] }]);
    await repo.list({}, undefined, 25);

    const input = sent[0].input;
    expect(input.IndexName).toBe('AllCallsIndex');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.KeyConditionExpression).toContain('GSI2PK = :allPk');
    expect(input.ExpressionAttributeValues[':allPk']).toBe('CALL#ALL');
    // internal receiving legs are always hidden from the log
    expect(input.FilterExpression).toBe('attribute_not_exists(internalLegOf)');
  });

  it('applies a date range as a sort-key BETWEEN condition', async () => {
    const { repo, sent } = makeRepo([{ Items: [] }]);
    await repo.list(
      { dateFrom: '2026-08-01', dateTo: '2026-08-04' },
      undefined,
      25,
    );

    const input = sent[0].input;
    expect(input.KeyConditionExpression).toContain('BETWEEN :skFrom AND :skTo');
    expect(input.ExpressionAttributeValues[':skFrom']).toBe('2026-08-01');
    // upper bound is made inclusive for the whole day by a high-sorting suffix
    expect(input.ExpressionAttributeValues[':skTo']).toBe('2026-08-04￿');
  });

  it('maps status/direction/agent/number filters into a FilterExpression', async () => {
    const { repo, sent } = makeRepo([{ Items: [] }]);
    await repo.list(
      {
        status: 'completed',
        direction: 'inbound',
        agentId: 'agent-1',
        number: '404555',
      },
      undefined,
      25,
    );

    const input = sent[0].input;
    expect(input.FilterExpression).toContain('#status = :status');
    expect(input.FilterExpression).toContain('#direction = :direction');
    expect(input.FilterExpression).toContain('agentId = :agentId');
    expect(input.FilterExpression).toContain(
      '(contains(#from, :number) OR contains(#to, :number))',
    );
    expect(input.ExpressionAttributeNames['#status']).toBe('status');
    expect(input.ExpressionAttributeValues[':number']).toBe('404555');
  });

  it('keeps querying internal pages until the limit is filled', async () => {
    const { repo, sent } = makeRepo([
      { Items: [item('CA1')], LastEvaluatedKey: { PK: 'CALL#CA1' } },
      { Items: [item('CA2')], LastEvaluatedKey: { PK: 'CALL#CA2' } },
      { Items: [item('CA3')] },
    ]);
    const res = await repo.list({}, undefined, 3);

    expect(sent).toHaveLength(3);
    expect(res.items.map((c) => c.callSid)).toEqual(['CA1', 'CA2', 'CA3']);
    expect(res.nextCursor).toBeUndefined(); // last page exhausted
  });

  it('returns a cursor that resumes exactly where the page ended', async () => {
    const { repo, sent } = makeRepo([
      { Items: [item('CA1'), item('CA2')], LastEvaluatedKey: { PK: 'CALL#CA2' } },
    ]);
    const first = await repo.list({}, undefined, 2);
    expect(first.nextCursor).toBeDefined();

    await repo.list({}, first.nextCursor, 2);
    const second = sent[1].input;
    expect(second.ExclusiveStartKey).toEqual({ PK: 'CALL#CA2' });
  });

  it('stops early with a synthesized cursor when the limit fills mid-page', async () => {
    const { repo } = makeRepo([
      { Items: [item('CA1'), item('CA2'), item('CA3')], LastEvaluatedKey: { PK: 'CALL#CA3' } },
    ]);
    const res = await repo.list({}, undefined, 2);
    expect(res.items).toHaveLength(2);
    // a cursor must exist so CA3 isn't skipped on the next page
    expect(res.nextCursor).toBeDefined();
  });
});

describe('CallsRepository.listLive', () => {
  it('restricts to the recent window and live statuses only', async () => {
    const { repo, sent } = makeRepo([{ Items: [item('CA9', { status: 'in-progress' })] }]);
    const res = await repo.listLive();

    const input = sent[0].input;
    expect(input.IndexName).toBe('AllCallsIndex');
    // 24h lower bound on the time-ordered sort key
    expect(input.KeyConditionExpression).toContain('GSI2SK >= :skFrom');
    const skFrom = input.ExpressionAttributeValues[':skFrom'];
    const age = Date.now() - new Date(skFrom).getTime();
    expect(age).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(age).toBeLessThan(25 * 60 * 60 * 1000);
    // live statuses enumerated in the filter
    expect(input.FilterExpression).toContain('#status IN');
    expect(Object.values(input.ExpressionAttributeValues)).toEqual(
      expect.arrayContaining(['queued', 'initiated', 'ringing', 'in-progress']),
    );
    expect(res.map((c) => c.callSid)).toEqual(['CA9']);
  });
});

describe('CallsRepository — legacy record hydration', () => {
  it('derives a missing callSid from the PK on every read path', async () => {
    // Pre-2026-08-05 records never materialized callSid as an attribute.
    const legacy = { ...item('ignored'), PK: 'CALL#CAlegacy77' } as Record<string, unknown>;
    delete legacy.callSid;

    const client = {
      send: jest.fn(async (cmd: SentCommand) =>
        'Key' in cmd.input ? { Item: { ...legacy } } : { Items: [{ ...legacy }] },
      ),
    };
    const repo = new CallsRepository({ client } as unknown as DynamoDbService);

    expect((await repo.getBySid('CAlegacy77'))?.callSid).toBe('CAlegacy77');
    expect((await repo.list({}, undefined, 5)).items[0].callSid).toBe('CAlegacy77');
    expect((await repo.listLive())[0].callSid).toBe('CAlegacy77');
  });
});

describe('CallsRepository.getBySid', () => {
  it('reads the record by its primary key', async () => {
    const sent: SentCommand[] = [];
    const client = {
      send: jest.fn(async (cmd: SentCommand) => {
        sent.push(cmd);
        return { Item: item('CA7') };
      }),
    };
    const repo = new CallsRepository({ client } as unknown as DynamoDbService);
    const rec = await repo.getBySid('CA7');

    expect(sent[0].input.Key).toEqual({ PK: 'CALL#CA7', SK: 'METADATA' });
    expect(rec?.callSid).toBe('CA7');
  });

  it('returns null for a missing call', async () => {
    const client = { send: jest.fn(async () => ({})) };
    const repo = new CallsRepository({ client } as unknown as DynamoDbService);
    expect(await repo.getBySid('CAnope')).toBeNull();
  });
});
