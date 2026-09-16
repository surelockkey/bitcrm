import { CountersRecountService } from '../../../src/counters/counters-recount.service';
import { InboxCountersRepository } from '../../../src/counters/inbox-counters.repository';
import { mockDynamo } from '../mocks';

const NOW = new Date('2026-09-15T12:00:00.000Z');

/**
 * The walk reads, per year: GSI1 open, GSI1 archived, then GSI3 for each of
 * the five kinds — seven partitions a year. `counts` is keyed by partition
 * key so a test only has to name the partitions that hold anything.
 */
function makeService(counts: Record<string, number | number[]>, minYear = 2025) {
  const { dynamo, sent } = mockDynamo();
  (dynamo.client.send as jest.Mock).mockImplementation(async (cmd: any) => {
    sent.push({ name: cmd.constructor.name, input: cmd.input });
    if (cmd.constructor.name !== 'QueryCommand') return {};
    const pk = cmd.input.ExpressionAttributeValues[':pk'];
    const scripted = counts[pk] ?? 0;
    // An array is a paginated partition: one entry per page.
    if (Array.isArray(scripted)) {
      const page = cmd.input.ExclusiveStartKey ? (cmd.input.ExclusiveStartKey.i as number) : 0;
      const last = page === scripted.length - 1;
      return {
        Count: scripted[page],
        ConsumedCapacity: { CapacityUnits: 1 },
        LastEvaluatedKey: last ? undefined : { i: page + 1 },
      };
    }
    return { Count: scripted, ConsumedCapacity: { CapacityUnits: 0.5 } };
  });
  const repo = new InboxCountersRepository(dynamo);
  jest.spyOn(repo, 'setTotals').mockResolvedValue(undefined);
  return { service: new CountersRecountService(dynamo, repo), repo, sent, minYear };
}

describe('CountersRecountService', () => {
  it('sums the open, archived and per-kind partitions across the years', async () => {
    const { service, repo, sent } = makeService({
      'INBOX#open#2026': 40_000,
      'INBOX#open#2025': 2_657,
      'INBOX#archived#2026': 2,
      'CAT#client#2026': 40_000,
      'CAT#client#2025': 2_423,
      'CAT#team#2026': 234,
    });

    const result = await service.recount({ now: NOW, minYear: 2025 });

    // The reference screenshot: All 42657, Requests 0, Clients 42423, Team 234, Archived 2.
    expect(result.totalConversations).toBe(42_657);
    expect(result.archivedConversations).toBe(2);
    expect(result.totalByKind).toEqual({ client: 42_423, team: 234 });
    // Zero-sized categories are left out of the map, not written as 0 noise.
    expect(result.totalByKind.unknown).toBeUndefined();

    expect(repo.setTotals).toHaveBeenCalledWith(
      { totalConversations: 42_657, totalByKind: { client: 42_423, team: 234 }, archivedConversations: 2 },
      result.recountedAt,
    );
    // Two years × (2 states + 5 kinds).
    expect(result.partitions).toBe(14);
    expect(sent.every((s) => s.name === 'QueryCommand')).toBe(true);
  });

  it('counts with Select COUNT on the right indexes, never a Scan or a filter', async () => {
    const { service, sent } = makeService({});
    await service.recount({ now: NOW, minYear: 2026 });

    expect(sent).toHaveLength(7);
    for (const s of sent) {
      expect(s.name).toBe('QueryCommand');
      expect(s.input.Select).toBe('COUNT');
      expect(s.input.FilterExpression).toBeUndefined();
      expect(s.input.KeyConditionExpression).toBe('#pk = :pk');
    }
    const pks = sent.map((s) => s.input.ExpressionAttributeValues[':pk']);
    expect(pks).toEqual([
      'INBOX#open#2026',
      'INBOX#archived#2026',
      'CAT#client#2026',
      'CAT#unknown#2026',
      'CAT#team#2026',
      'CAT#group#2026',
      'CAT#external#2026',
    ]);
    expect(sent[0].input.IndexName).toBe('InboxIndex');
    expect(sent[2].input.IndexName).toBe('CategoryIndex');
  });

  it('follows LastEvaluatedKey — a COUNT stops at 1 MB, so a big year needs several trips', async () => {
    const { service, sent } = makeService({ 'INBOX#open#2026': [900, 900, 431] });
    const result = await service.recount({ now: NOW, minYear: 2026 });

    expect(result.totalConversations).toBe(2_231);
    // Three pages for the open partition, one each for the other six.
    expect(sent).toHaveLength(9);
    expect(result.queries).toBe(9);
    expect(result.partitions).toBe(7);
  });

  it('is idempotent — a second run over unchanged data writes the same totals', async () => {
    const counts = { 'INBOX#open#2026': 11, 'CAT#client#2026': 11, 'INBOX#archived#2026': 3 };
    const first = await makeService(counts).service.recount({ now: NOW, minYear: 2026 });
    const second = await makeService(counts).service.recount({ now: NOW, minYear: 2026 });

    expect({ ...first, recountedAt: '', seconds: 0 }).toEqual({ ...second, recountedAt: '', seconds: 0 });
    expect(second.totalConversations).toBe(11);
  });

  it('reports the capacity it consumed, so the operator can see what the rebuild cost', async () => {
    const { service } = makeService({ 'INBOX#open#2026': 5 });
    const result = await service.recount({ now: NOW, minYear: 2026 });
    // Seven partitions at the scripted 0.5 RCU each.
    expect(result.consumedRcu).toBeCloseTo(3.5);
  });

  it('writes zeros for a genuinely empty table rather than leaving the totals unknown', async () => {
    const { service, repo } = makeService({});
    const result = await service.recount({ now: NOW, minYear: 2026 });

    expect(result.totalConversations).toBe(0);
    expect(result.archivedConversations).toBe(0);
    expect(repo.setTotals).toHaveBeenCalledWith(
      { totalConversations: 0, totalByKind: {}, archivedConversations: 0 },
      result.recountedAt,
    );
  });
});
