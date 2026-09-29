import { JobSuperStatus, type DealStats, type DealStatsBucket } from '@bitcrm/types';
import {
  jobsNowOf,
  salesOf,
  scoreboardOf,
  todayOf,
  topShares,
} from 'src/deals/stats/dashboard-widgets';

/**
 * Віджети дашборда — зрізи одного агрегату `/deals/stats`, щоб цифри на
 * головній ніколи не розійшлися зі звітом Job Statistics за той самий період.
 */
const bucket = (key: string, over: Partial<DealStatsBucket> = {}): DealStatsBucket => ({
  key,
  all: 0,
  done: 0,
  open: 0,
  canceled: 0,
  ...over,
});

const byStatus = (over: Partial<Record<JobSuperStatus, number>> = {}) =>
  ({
    submitted: 0,
    in_progress: 0,
    pending: 0,
    done_pending_approval: 0,
    done: 0,
    canceled: 0,
    ...over,
  }) as Record<JobSuperStatus, number>;

const stats = (over: Partial<DealStats> = {}): DealStats => ({
  window: { by: 'closed', from: '2026-09-27', to: '2026-09-28' },
  jobs: { total: 0, byStatus: byStatus() },
  series: [],
  byTech: [],
  byCreator: [],
  byJobType: [],
  bySource: [],
  byServiceArea: [],
  byCity: [],
  byZip: [],
  ...over,
});

describe('topShares — пиріг Top Sources / Job Types / Service Areas', () => {
  it('takes the four busiest by jobs and names them', () => {
    const out = topShares(
      [bucket('a', { all: 1 }), bucket('b', { all: 5 }), bucket('c', { all: 3 }), bucket('d', { all: 2 }), bucket('e', { all: 4 })],
      { b: 'Google Ads', e: 'Yelp' },
    );

    expect(out.map((s) => s.key)).toEqual(['b', 'e', 'c', 'd']);
    expect(out[0]).toMatchObject({ name: 'Google Ads', count: 5 });
    // Без імені в каталозі — ключ як є: зона обслуговування і є своїм іменем.
    expect(out[2].name).toBe('c');
  });

  it('percent is the share of the slices shown, as Workiz draws it', () => {
    const out = topShares([bucket('a', { all: 3 }), bucket('b', { all: 1 })], {});

    expect(out.map((s) => s.percent)).toEqual([75, 25]);
  });

  it('rounds to two decimals', () => {
    const out = topShares([bucket('a', { all: 1 }), bucket('b', { all: 1 }), bucket('c', { all: 1 })], {});

    expect(out[0].percent).toBe(33.33);
  });

  it('leaves out jobs without a key — "not set" is not a source', () => {
    const out = topShares([bucket('', { all: 9 }), bucket('a', { all: 1 })], {});

    expect(out).toEqual([{ key: 'a', name: 'a', count: 1, percent: 100 }]);
  });

  it('ties go by key so the legend does not reshuffle between refreshes', () => {
    const out = topShares([bucket('b', { all: 2 }), bucket('a', { all: 2 })], {});

    expect(out.map((s) => s.key)).toEqual(['a', 'b']);
  });

  it('an empty window is no slices', () => {
    expect(topShares([], {})).toEqual([]);
  });
});

describe('salesOf — «Sales»: Total і Net по днях', () => {
  it('total is revenue, net is profit, day by day and summed', () => {
    const out = salesOf(
      stats({
        series: [
          { date: '2026-09-27', jobs: 2, canceled: 0, revenue: 100.5, profit: 60.25 },
          { date: '2026-09-28', jobs: 0, canceled: 0, revenue: 0, profit: 0 },
        ],
      }),
    );

    expect(out.days).toEqual([
      { date: '2026-09-27', total: 100.5, net: 60.25 },
      { date: '2026-09-28', total: 0, net: 0 },
    ]);
    expect(out.total).toBe(100.5);
    expect(out.net).toBe(60.25);
  });

  it('sums in cents — no 0.30000000000000004 in the header', () => {
    const out = salesOf(
      stats({
        series: [
          { date: '2026-09-27', jobs: 1, canceled: 0, revenue: 0.1, profit: 0.1 },
          { date: '2026-09-28', jobs: 1, canceled: 0, revenue: 0.2, profit: 0.2 },
        ],
      }),
    );

    expect(out.total).toBe(0.3);
  });
});

describe('scoreboardOf — Tech / Dispatch Scoreboard', () => {
  const rows = [
    bucket('u1', { done: 40, revenue: 27_240.25 }),
    bucket('u2', { done: 4, revenue: 114_383.07 }),
    bucket('u3', { done: 0, open: 5 }),
  ];

  it('with money: ranked by sales, jobs are the Done ones', () => {
    const out = scoreboardOf(rows, { u1: 'Tess', u2: 'Betty' }, true);

    expect(out).toEqual([
      { id: 'u2', name: 'Betty', jobs: 4, sales: 114_383.07 },
      { id: 'u1', name: 'Tess', jobs: 40, sales: 27_240.25 },
    ]);
  });

  it('without money: ranked by jobs and no amount at all', () => {
    const out = scoreboardOf(rows, {}, false);

    expect(out.map((r) => r.id)).toEqual(['u1', 'u2']);
    expect(out[0]).not.toHaveProperty('sales');
    expect(out[0].name).toBe('');
  });

  it('nobody with no sale in the window, and nobody without an id', () => {
    const out = scoreboardOf([bucket('', { done: 3 }), bucket('u3', { open: 5 })], {}, true);

    expect(out).toEqual([]);
  });

  it('five rows at most', () => {
    const many = Array.from({ length: 8 }, (_, i) => bucket(`u${i}`, { done: i + 1 }));

    expect(scoreboardOf(many, {}, false)).toHaveLength(5);
  });
});

describe('todayOf — «Today»', () => {
  it('done, canceled and sales from the jobs closed today; created from those created', () => {
    const closed = stats({
      jobs: { total: 5, byStatus: byStatus({ done: 3, canceled: 2 }) },
      money: {
        revenue: 51_041.62, tax: 0, cost: 0, profit: 0, avgSale: 0, avgProfit: 0, avgPerDay: 0, doneJobs: 3,
      },
    });
    const created = stats({ jobs: { total: 4, byStatus: byStatus({ submitted: 4 }) } });

    expect(todayOf(closed, created)).toEqual({
      sales: 51_041.62,
      jobsDone: 3,
      jobsCanceled: 2,
      jobsCreated: 4,
    });
  });

  it('no sales key without money', () => {
    const out = todayOf(stats(), stats());

    expect(out).not.toHaveProperty('sales');
  });
});

describe('jobsNowOf — «Jobs»: відкриті стани зараз', () => {
  it('the four unclosed states, unknown counts as zero', () => {
    const out = jobsNowOf({
      submitted: 237,
      pending: 306,
      in_progress: 3,
      done_pending_approval: null,
      done: 9999,
      canceled: 1,
    } as Record<JobSuperStatus, number | null>);

    expect(out).toEqual({
      byStatus: { submitted: 237, pending: 306, in_progress: 3, done_pending_approval: 0 },
    });
  });
});
