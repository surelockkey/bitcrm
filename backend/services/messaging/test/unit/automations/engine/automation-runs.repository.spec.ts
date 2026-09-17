import { type AutomationRun } from '@bitcrm/types';
import {
  AUTO_RUN_FEED_MAX_QUERIES,
  AUTO_RUN_TTL_SECONDS,
  autoRunFeedMonths,
} from '../../../../src/automations/automations.constants';
import { AutomationRunsRepository } from '../../../../src/automations/engine/automation-runs.repository';
import { InvalidCursorError, encodeCursor } from '../../../../src/common/cursor';
import { conditionalCheckFailed, mockDynamo, T1 } from '../../mocks';

const run = (over: Partial<AutomationRun> = {}): AutomationRun => ({
  id: 'run-1',
  ruleId: 'r1',
  firedAt: T1,
  trigger: 'deal.status_changed',
  entity: 'deal:d1',
  dealId: 'd1',
  occurrence: 'status:submitted>done',
  outcome: 'sent',
  actions: [{ type: 'send_sms', to: 'client', outcome: 'sent', messageId: 'm1' }],
  ...over,
});

describe('AutomationRunsRepository', () => {
  it('claims a firing once — the second caller is told it is taken', async () => {
    const { dynamo, sent } = mockDynamo([{}, conditionalCheckFailed()]);
    const repo = new AutomationRunsRepository(dynamo);

    expect(await repo.claim('r1', 'deal:d1', 'status:x', T1)).toBe(true);
    expect(await repo.claim('r1', 'deal:d1', 'status:x', T1)).toBe(false);

    expect(sent[0]).toMatchObject({
      name: 'PutCommand',
      input: {
        Item: expect.objectContaining({ PK: 'AUTORUN#r1', SK: 'ONCE#deal:d1#status:x', ruleId: 'r1' }),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
    // 90 days of TTL on the marker.
    expect(sent[0].input.Item.expiresAt).toBe(Math.floor(new Date(T1).getTime() / 1000) + 90 * 24 * 60 * 60);
  });

  it('rethrows anything that is not a lost race', async () => {
    const { dynamo } = mockDynamo([new Error('throttled')]);
    const repo = new AutomationRunsRepository(dynamo);
    await expect(repo.claim('r1', 'deal:d1', 'o')).rejects.toThrow('throttled');
  });

  it('releases a claim so the next delivery may retry', async () => {
    const { dynamo, sent } = mockDynamo();
    await new AutomationRunsRepository(dynamo).release('r1', 'deal:d1', 'status:x');
    expect(sent[0]).toMatchObject({
      name: 'DeleteCommand',
      input: { Key: { PK: 'AUTORUN#r1', SK: 'ONCE#deal:d1#status:x' } },
    });
  });

  it('logs a firing under RUN#<firedAt>#<id> with a 30-day TTL, and into its month of the feed index', async () => {
    const { dynamo, sent } = mockDynamo();
    await new AutomationRunsRepository(dynamo).log(run());
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toMatchObject({
      PK: 'AUTORUN#r1',
      SK: `RUN#${T1}#run-1`,
      GSI3PK: 'AUTORUN#2026-09',
      GSI3SK: `${T1}#run-1`,
      outcome: 'sent',
      expiresAt: Math.floor(new Date(T1).getTime() / 1000) + 30 * 24 * 60 * 60,
    });
  });

  it('lists a rule\'s firings newest first, without the TTL attribute', async () => {
    const { dynamo, sent } = mockDynamo([
      { Items: [{ PK: 'AUTORUN#r1', SK: `RUN#${T1}#run-1`, expiresAt: 1, ...run() }] },
    ]);
    const runs = await new AutomationRunsRepository(dynamo).listByRule('r1', 5);
    expect(runs).toEqual([run()]);
    expect(sent[0]).toMatchObject({
      name: 'QueryCommand',
      input: {
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': 'AUTORUN#r1', ':sk': 'RUN#' },
        ScanIndexForward: false,
        Limit: 5,
      },
    });
  });

  // --- the account-wide feed (GET /automations/runs)

  const NOW = new Date('2026-09-16T12:00:00.000Z');
  const feedRow = (firedAt: string, id: string) => ({
    GSI3PK: `AUTORUN#${firedAt.slice(0, 7)}`,
    GSI3SK: `${firedAt}#${id}`,
    expiresAt: 1,
    ...run({ id, firedAt }),
  });

  it('reads the month partitions newest first and stops when they are exhausted', async () => {
    const { dynamo, sent } = mockDynamo([
      { Items: [feedRow(T1, 'run-1')] },
      { Items: [feedRow('2026-08-30T09:00:00.000Z', 'run-0')] },
    ]);
    const page = await new AutomationRunsRepository(dynamo).listFeed({ limit: 50, now: NOW });

    expect(page.items.map((r) => r.id)).toEqual(['run-1', 'run-0']);
    expect(page.items[0]).toEqual(run()); // key and TTL attributes stripped
    expect(page.nextCursor).toBeUndefined();
    expect(sent.map((c) => c.input.ExpressionAttributeValues[':pk'])).toEqual(['AUTORUN#2026-09', 'AUTORUN#2026-08']);
    expect(sent[0]).toMatchObject({
      name: 'QueryCommand',
      input: {
        IndexName: 'CategoryIndex',
        KeyConditionExpression: 'GSI3PK = :pk',
        ScanIndexForward: false,
        Limit: 50,
      },
    });
    expect(sent[0].input).not.toHaveProperty('FilterExpression');
  });

  /**
   * The 30-day TTL is what keeps this to two Queries — but only almost: 30
   * days before 1 March is 30 January, because February is shorter than the
   * window, so the partitions are computed from the window and not assumed.
   */
  it('covers the whole retention window, including the month a short February reaches past', () => {
    expect(autoRunFeedMonths(new Date('2026-09-16T12:00:00.000Z'))).toEqual(['2026-09', '2026-08']);
    // On the 1st the window (plus the sweeper's grace) reaches into the month before last.
    expect(autoRunFeedMonths(new Date('2026-09-01T00:00:00.000Z'))).toEqual(['2026-09', '2026-08', '2026-07']);
    // 1 March 2027 − 30 days = 30 January 2027: a run that day is still alive.
    expect(autoRunFeedMonths(new Date('2027-03-01T00:00:00.000Z'))).toEqual(['2027-03', '2027-02', '2027-01']);
    const oldestAlive = new Date(Date.parse('2027-03-01T00:00:00.000Z') - AUTO_RUN_TTL_SECONDS * 1000);
    expect(autoRunFeedMonths(new Date('2027-03-01T00:00:00.000Z'))).toContain(oldestAlive.toISOString().slice(0, 7));
    // `since` only ever shortens the walk, and never past what still exists.
    expect(autoRunFeedMonths(NOW, '2026-09-10T00:00:00.000Z')).toEqual(['2026-09']);
    expect(autoRunFeedMonths(NOW, '2019-01-01T00:00:00.000Z')).toEqual(['2026-09', '2026-08']);
  });

  it('pages with an opaque cursor and resumes in the partition it stopped in', async () => {
    const stoppedAt = { PK: 'AUTORUN#r1', SK: `RUN#${T1}#run-1` };
    const { dynamo, sent } = mockDynamo([{ Items: [feedRow(T1, 'run-1')], LastEvaluatedKey: stoppedAt }]);
    const repo = new AutomationRunsRepository(dynamo);

    const first = await repo.listFeed({ limit: 1, now: NOW });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();

    const next = mockDynamo([{ Items: [feedRow('2026-09-14T09:00:00.000Z', 'run-2')] }, { Items: [] }]);
    await new AutomationRunsRepository(next.dynamo).listFeed({ limit: 1, cursor: first.nextCursor, now: NOW });
    expect(next.sent[0].input.ExpressionAttributeValues[':pk']).toBe('AUTORUN#2026-09');
    expect(next.sent[0].input.ExclusiveStartKey).toEqual(stoppedAt);
    expect(sent).toHaveLength(1);
  });

  it('rejects a cursor that is not ours, or points at a partition the feed no longer reads', async () => {
    const { dynamo } = mockDynamo();
    const repo = new AutomationRunsRepository(dynamo);
    for (const cursor of [
      'not-base64-json',
      encodeCursor({ k: { PK: 'x' } }),
      encodeCursor({ p: '2019-01' }),
      // `typeof null` and `typeof []` are 'object' too, and neither is a key.
      encodeCursor({ p: '2026-09', k: null } as object),
      encodeCursor({ p: '2026-09', k: [] }),
    ]) {
      await expect(repo.listFeed({ limit: 10, cursor, now: NOW })).rejects.toBeInstanceOf(InvalidCursorError);
    }
  });

  it('reads the feed, not one rule, when no rule is named', async () => {
    const { dynamo, sent } = mockDynamo([{ Items: [] }, { Items: [] }]);
    // `listFeed` picks the partitions on truthiness; the query has to agree,
    // or an empty `ruleId` reads a month partition off the base table.
    await new AutomationRunsRepository(dynamo).listFeed({ limit: 10, ruleId: '', now: NOW });
    expect(sent[0].input.IndexName).toBe('CategoryIndex');
    expect(sent[0].input.ExpressionAttributeValues[':pk']).toBe('AUTORUN#2026-09');
  });

  it('narrows by since as a key condition, on the feed and on one rule', async () => {
    const since = '2026-09-10T00:00:00.000Z';
    const { dynamo, sent } = mockDynamo([{ Items: [] }]);
    await new AutomationRunsRepository(dynamo).listFeed({ limit: 50, since, now: NOW });
    expect(sent[0].input).toMatchObject({
      KeyConditionExpression: 'GSI3PK = :pk AND GSI3SK >= :sk',
      ExpressionAttributeValues: { ':pk': 'AUTORUN#2026-09', ':sk': since },
    });

    const byRule = mockDynamo([{ Items: [] }]);
    await new AutomationRunsRepository(byRule.dynamo).listFeed({ limit: 50, ruleId: 'r1', since, now: NOW });
    expect(byRule.sent[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND SK >= :sk',
      ExpressionAttributeValues: { ':pk': 'AUTORUN#r1', ':sk': `RUN#${since}` },
    });
    expect(byRule.sent[0].input).not.toHaveProperty('IndexName');
  });

  it('serves one rule from its own partition, so it sees runs logged before the feed index existed', async () => {
    const { dynamo, sent } = mockDynamo([
      { Items: [{ PK: 'AUTORUN#r1', SK: `RUN#${T1}#run-1`, expiresAt: 1, ...run() }] },
    ]);
    const page = await new AutomationRunsRepository(dynamo).listFeed({ limit: 50, ruleId: 'r1', now: NOW });
    expect(page.items).toEqual([run()]);
    expect(page.nextCursor).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'AUTORUN#r1', ':sk': 'RUN#' },
    });
  });

  it('filters on outcome, and gives up after a bounded number of Queries rather than scanning a month', async () => {
    const empty = { Items: [], LastEvaluatedKey: { PK: 'AUTORUN#r1', SK: `RUN#${T1}#run-1` } };
    const { dynamo, sent } = mockDynamo(Array.from({ length: 12 }, () => empty));
    const page = await new AutomationRunsRepository(dynamo).listFeed({ limit: 50, outcome: 'failed', now: NOW });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeTruthy(); // short page, but not the end
    expect(sent).toHaveLength(AUTO_RUN_FEED_MAX_QUERIES);
    expect(sent[0].input).toMatchObject({
      FilterExpression: '#outcome = :outcome',
      ExpressionAttributeNames: { '#outcome': 'outcome' },
      ExpressionAttributeValues: { ':outcome': 'failed' },
    });
  });

  it('bumps the rule counter atomically and swallows a missing row', async () => {
    const { dynamo, sent } = mockDynamo([{}, conditionalCheckFailed()]);
    const repo = new AutomationRunsRepository(dynamo);
    await repo.bump('r1', T1);
    expect(sent[0]).toMatchObject({
      name: 'UpdateCommand',
      input: {
        Key: { PK: 'AUTOMATION#r1', SK: 'METADATA' },
        UpdateExpression: 'ADD firedCount :one SET lastFiredAt = :at',
        ExpressionAttributeValues: { ':one': 1, ':at': T1 },
      },
    });
    await expect(repo.bump('builtin-never-stored', T1)).resolves.toBeUndefined();
  });
});
