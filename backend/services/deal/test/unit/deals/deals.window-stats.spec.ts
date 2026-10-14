/**
 * The dashboard's snapshot miss path: ONE projected window read
 * (`DealsRepository.readStatsWindow`) instead of paging the jobs list a
 * hundred rows at a time (`DealsService.stats`). Same numbers — checked here
 * on fixture data through a real `DealsRepository` over an in-memory table
 * that answers both paths' Queries (Limit, cursors, order, projection).
 */
import { DealStatus, JobSuperStatus, SUPER_STATUS_ORDER, type Deal } from '@bitcrm/types';
import { DealsRepository } from '../../../src/deals/deals.repository';
import { DealsService } from '../../../src/deals/deals.service';
import { createMockDeal, createMockJwtUser } from '../mocks';

type Item = Record<string, any>;

/** Just enough DynamoDB for the index Queries both paths send. */
function memoryTable() {
  const rows: Item[] = [];
  const queries: Item[] = [];
  const send = jest.fn(async (cmd: any) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    if (name === 'PutCommand') {
      rows.push(structuredClone(input.Item));
      return {};
    }
    if (name !== 'QueryCommand') throw new Error(`unexpected ${name}`);
    queries.push(input);
    const names = input.ExpressionAttributeNames ?? {};
    const v = input.ExpressionAttributeValues ?? {};
    const pkAttr = names['#pk'];
    const skAttr = names['#sk'];
    if (!pkAttr || !skAttr || !/BETWEEN :from AND :to/.test(input.KeyConditionExpression)) {
      throw new Error(`unsupported key condition ${input.KeyConditionExpression}`);
    }
    if (input.FilterExpression !== '#status = :active') throw new Error(`unsupported filter ${input.FilterExpression}`);
    let part = rows
      .filter((r) => r[pkAttr] === v[':pk'] && typeof r[skAttr] === 'string' && r[skAttr] >= v[':from'] && r[skAttr] <= v[':to'])
      .sort((a, b) => (a[skAttr] < b[skAttr] ? -1 : a[skAttr] > b[skAttr] ? 1 : 0));
    if (input.ScanIndexForward === false) part = part.reverse();
    if (input.ExclusiveStartKey) {
      const at = part.findIndex((r) => r.PK === input.ExclusiveStartKey.PK && r[skAttr] === input.ExclusiveStartKey[skAttr]);
      part = part.slice(at + 1);
    }
    const limit = input.Limit ?? 50; // a "1 MB" page
    const read = part.slice(0, limit);
    const more = part.length > limit;
    const last = read[read.length - 1];
    let items = read.filter((r) => r.status === v[':active']);
    if (input.ProjectionExpression) {
      const attrs = input.ProjectionExpression.split(',').map((p: string) => names[p.trim()] ?? p.trim());
      items = items.map((r) => Object.fromEntries(attrs.filter((a: string) => a in r).map((a: string) => [a, r[a]])));
    }
    return {
      Items: items,
      Count: items.length,
      ScannedCount: read.length,
      ...(more && last && { LastEvaluatedKey: { PK: last.PK, SK: last.SK, [pkAttr]: last[pkAttr], [skAttr]: last[skAttr] } }),
    };
  });
  return { rows, queries, dynamoDb: { client: { send } } };
}

/** A small deterministic generator — the same fixture every run. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function fixture(): Deal[] {
  const r = rng(42);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const deals: Deal[] = [];
  const base = Date.parse('2026-08-24T00:00:00.000Z');
  for (let i = 0; i < 180; i++) {
    // Hours across the whole day, so evening Eastern jobs land on the next UTC date.
    const created = new Date(base + Math.floor(r() * 20 * 86_400_000)).toISOString();
    const superStatus = pick(SUPER_STATUS_ORDER);
    const closed =
      superStatus === JobSuperStatus.DONE || superStatus === JobSuperStatus.CANCELED
        ? new Date(Date.parse(created) + Math.floor(r() * 6 * 86_400_000)).toISOString()
        : undefined;
    const total = Math.round(r() * 90_000) / 100;
    deals.push(
      createMockDeal({
        id: `d${String(i).padStart(3, '0')}`,
        createdAt: created,
        updatedAt: created,
        superStatus,
        closedAt: closed,
        status: r() < 0.08 ? DealStatus.DELETED : DealStatus.ACTIVE,
        assignedTechIds: ['t1', 't2', 't3', 't4'].filter(() => r() < 0.35),
        createdBy: pick(['u1', 'u2', 'u3']),
        jobTypeId: pick(['jt1', 'jt2', 'jt3']),
        sourceId: pick(['s1', 's2', undefined]),
        serviceArea: pick(['CT', 'TX', 'NY']),
        address: { street: '1 Main', city: pick(['Hartford', 'Dallas']), state: 'CT', zip: pick(['06101', '75201']), country: 'US' } as never,
        totals: { subtotal: total, discount: 0, tax: Math.round(total * 6.35) / 100, total, cost: Math.round(r() * 2000) / 100 } as never,
        scheduledDate: created.slice(0, 10),
      }),
    );
  }
  return deals;
}

describe('DealsService.windowStats — the dashboard miss path', () => {
  async function setup() {
    const table = memoryTable();
    const repository = new DealsRepository(table.dynamoDb as never);
    for (const d of fixture()) await repository.create(d);
    const stub = {} as never;
    const service = new DealsService(repository, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub);
    return { table, service };
  }

  const caller = createMockJwtUser({ id: 'system:dashboard-snapshot' });
  const window = { from: '2026-08-28', to: '2026-09-05' };

  it.each([
    ['created', true],
    ['created', false],
    ['closed', true],
    ['closed', false],
  ] as const)('by %s (money %s): exactly the numbers the paged list gave', async (by, money) => {
    const { table, service } = await setup();

    const old = await service.stats({ [`${by}From`]: window.from, [`${by}To`]: window.to } as never, caller, 'all', { money });
    const oldQueries = table.queries.length;
    const fresh = await service.windowStats(by, window, { money });
    const newQueries = table.queries.slice(oldQueries);

    expect(fresh).toEqual(old);
    // The fixture really exercises the window: jobs in it, some Done with money.
    expect(old.jobs.total).toBeGreaterThan(10);
    if (money) expect(old.money?.doneJobs).toBeGreaterThan(0);
    // One projected read, walked to the end of each partition — no 100-row pages.
    expect(newQueries.every((q) => q.ProjectionExpression && q.Limit === undefined)).toBe(true);
  });

  it('projects only what the aggregate reads — never the 4 KB METADATA row', async () => {
    const { table, service } = await setup();
    await service.windowStats('closed', window, { money: true });
    const projected = table.queries[0].ProjectionExpression.split(',').map((p: string) => table.queries[0].ExpressionAttributeNames[p.trim()]);
    expect(projected).toEqual(expect.arrayContaining(['id', 'superStatus', 'totals', 'closedAt', 'createdAt', 'assignedTechIds']));
    expect(projected).not.toContain('notes');
    expect(projected).not.toContain('searchText');
  });
});
