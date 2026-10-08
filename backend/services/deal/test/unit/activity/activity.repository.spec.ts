import { AccountClock } from '@bitcrm/types';
import { ActivityRepository } from 'src/activity/activity.repository';
import { ActivityCountsRepository } from 'src/activity/activity-counts.repository';
import { activityIndexFields } from 'src/activity/activity-index';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { withActivitySource } from 'src/activity/activity-source';
import { createMockDynamoDbService, createMockTimelineEntry } from '../mocks';
import { fakeActivityTable } from './fake-activity-table';

const clock = new AccountClock();

/** A native event at `timestamp` by `actorId`, indexed the way the writer indexes it. */
function event(n: number, timestamp: string, actorId = 'u1', text = 'Created Job', dealId = `d${n}`) {
  const item: Record<string, unknown> = {
    PK: `DEAL#${dealId}`,
    SK: `TIMELINE#${timestamp}#e${n}`,
    id: `e${n}`,
    dealId,
    // Any other line: an event that brings its own words (job notes are not Activity events).
    eventType: text === 'Created Job' ? 'created' : 'custom_action',
    ...(text !== 'Created Job' && { note: text }),
    actorId,
    actorName: `${actorId}@x.com`,
    timestamp,
    details: {},
  };
  return { ...item, ...activityIndexFields(item, clock) };
}

// Three New York days: Sep 1 (2 events), Sep 2 (3), Sep 3 (1). 14:00Z = 10 AM Eastern.
const ROWS = [
  event(1, '2026-09-01T14:00:00.000Z', 'u1'),
  event(2, '2026-09-01T15:00:00.000Z', 'u2', 'Added note: Logged In From 1.2.3.4'),
  event(3, '2026-09-02T14:00:00.000Z', 'u1'),
  event(4, '2026-09-02T15:00:00.000Z', 'u2'),
  event(5, '2026-09-02T16:00:00.000Z', 'u1', 'Added note: logged in again'),
  event(6, '2026-09-03T14:00:00.000Z', 'u2'),
];

const ids = (items: Record<string, unknown>[]) => items.map((i) => i.id);

describe('ActivityRepository — the period, newest first, by day', () => {
  it('walks the days from the last one back and pages on a cursor', async () => {
    const { dynamoDb } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    const base = { from: '2026-09-01', to: '2026-09-03', sort: 'desc' as const, limit: 4 };

    const first = await repo.page(base);
    expect(ids(first.items)).toEqual(['e6', 'e5', 'e4', 'e3']);

    const second = await repo.page({ ...base, cursor: first.next });
    expect(ids(second.items)).toEqual(['e2', 'e1']);
    expect(second.next).toBeUndefined();
  });

  it('turns round with sort=asc', async () => {
    const { dynamoDb } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    const page = await repo.page({ from: '2026-09-01', to: '2026-09-03', sort: 'asc', limit: 3 });
    expect(ids(page.items)).toEqual(['e1', 'e2', 'e3']);
  });

  it('searches the action text in the same walk', async () => {
    const { dynamoDb, calls } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    const page = await repo.page({ from: '2026-09-01', to: '2026-09-03', sort: 'desc', limit: 10, q: 'logged in' });
    expect(ids(page.items)).toEqual(['e5', 'e2']);
    expect(calls[0].input.FilterExpression).toBe('contains(#search, :q)');
  });

  it('finds a job’s events by its code', async () => {
    const { dynamoDb } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    const page = await repo.page({ from: '2026-09-01', to: '2026-09-03', sort: 'desc', limit: 10, q: 'ab12cd', qDealId: 'd3' });
    expect(ids(page.items)).toEqual(['e3']);
  });

  it('hands back what it found and a cursor when the read budget runs out', async () => {
    const { dynamoDb } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    const page = await repo.page({ from: '2026-09-01', to: '2026-09-03', sort: 'desc', limit: 10, q: 'nothing', budget: 2 });
    expect(page.items).toEqual([]);
    expect(page.next).toEqual({ d: '2026-09-01' });
  });
});

describe('ActivityRepository — chosen people', () => {
  it('merges each person’s events by time and pages on the last one handed out', async () => {
    const { dynamoDb, calls } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    const base = { from: '2026-09-01', to: '2026-09-03', sort: 'desc' as const, limit: 3, userIds: ['u1', 'u2'] };

    const first = await repo.page(base);
    expect(ids(first.items)).toEqual(['e6', 'e5', 'e4']);
    expect(calls[0].input.IndexName).toBe('ActorIndex');
    expect(calls[0].input.ExpressionAttributeValues[':lo']).toBe('2026-09-01T04:00:00.000Z');

    const second = await repo.page({ ...base, cursor: first.next });
    expect(ids(second.items)).toEqual(['e3', 'e2', 'e1']);
    // Both people are read to the start of the period: nothing is left.
    expect(second.next).toBeUndefined();
  });

  it('reads one person alone', async () => {
    const { dynamoDb } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    const page = await repo.page({ from: '2026-09-02', to: '2026-09-03', sort: 'desc', limit: 10, userIds: ['u2'] });
    expect(ids(page.items)).toEqual(['e6', 'e4']);
  });
});

describe('ActivityRepository — counting', () => {
  it('counts the matching rows over the days, and says when it ran out of budget', async () => {
    const { dynamoDb } = fakeActivityTable(ROWS);
    const repo = new ActivityRepository(dynamoDb as never);
    await expect(repo.count({ from: '2026-09-01', to: '2026-09-03', q: 'logged in' })).resolves.toEqual({ total: 2, atLeast: false });
    await expect(repo.count({ from: '2026-09-01', to: '2026-09-03', userIds: ['u1'] })).resolves.toEqual({ total: 3, atLeast: false });
    await expect(repo.count({ from: '2026-09-01', to: '2026-09-03', q: 'x', budget: 1 })).resolves.toEqual({ total: 0, atLeast: true });
  });

  it('looks a job code up on its reservation row', async () => {
    const { dynamoDb } = fakeActivityTable([{ PK: 'DEALNUM#AB12CD', SK: 'UNIQUE', dealId: 'd3' }]);
    const repo = new ActivityRepository(dynamoDb as never);
    await expect(repo.dealIdByNumber('ab12cd')).resolves.toBe('d3');
    await expect(repo.dealIdByNumber('logged in')).resolves.toBeUndefined();
  });

  it('sums the day counters', async () => {
    const { dynamoDb } = fakeActivityTable([
      { PK: 'ACTCOUNT#2026-09-01', SK: 'COUNT', count: 6632 },
      { PK: 'ACTCOUNT#2026-09-02', SK: 'COUNT', count: 5000 },
    ]);
    const counts = new ActivityCountsRepository(dynamoDb as never);
    await expect(counts.sum(['2026-09-01', '2026-09-02', '2026-09-03'])).resolves.toBe(11632);
  });
});

describe('TimelineRepository — every event is an Activity row', () => {
  it('writes the index keys, the search text and the source, and ticks the day', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    const counts = { add: jest.fn(async () => undefined) };
    const repo = new TimelineRepository(dynamoDb as never, counts as never);
    const entry = createMockTimelineEntry({ id: 't1', dealId: 'd9', timestamp: '2026-09-30T02:00:00.000Z' });

    await withActivitySource('mobile', () => repo.addEntry(entry));

    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    // 02:00 UTC on the 30th is still the 29th in New York.
    expect(item).toMatchObject({
      PK: 'DEAL#d9',
      GSI8PK: 'ACTDAY#2026-09-29',
      GSI8SK: '2026-09-30T02:00:00.000Z#t1',
      activitySource: 'mobile',
      activitySearch: 'created job',
    });
    expect(counts.add).toHaveBeenCalledWith('2026-09-29', 1);
  });

  it('uncounts a deleted event only if it had been counted', async () => {
    const dynamoDb = createMockDynamoDbService();
    const counts = { add: jest.fn(async () => undefined) };
    const repo = new TimelineRepository(dynamoDb as never, counts as never);

    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: { GSI8PK: 'ACTDAY#2026-09-29' } });
    await repo.deleteEntry('d9', '2026-09-30T02:00:00.000Z', 't1');
    expect(dynamoDb.client.send.mock.calls[0][0].input.ReturnValues).toBe('ALL_OLD');
    expect(counts.add).toHaveBeenCalledWith('2026-09-29', -1);

    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: { PK: 'DEAL#d9' } });
    await repo.deleteEntry('d9', '2026-09-01T02:00:00.000Z', 't0');
    expect(counts.add).toHaveBeenCalledTimes(1);
  });
});
