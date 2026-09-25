import { JobSuperStatus } from '@bitcrm/types';
import { aggregateDealStats } from 'src/deals/stats/deal-stats';
import { createMockDeal } from '../../mocks';

const money = (total: number, tax = 0, cost = 0) => ({ subtotal: total - tax, discount: 0, tax, total, cost });

const window = { by: 'created' as const, from: '2026-09-01', to: '2026-09-03' };

const deals = [
  createMockDeal({
    id: 'a', createdAt: '2026-09-01T10:00:00.000Z', superStatus: JobSuperStatus.DONE,
    assignedTechIds: ['t1', 't2'], createdBy: 'd1', jobTypeId: 'lockout', sourceId: 'google', serviceArea: 'North',
    totals: money(110, 10, 30),
  }),
  createMockDeal({
    id: 'b', createdAt: '2026-09-01T18:00:00.000Z', superStatus: JobSuperStatus.IN_PROGRESS,
    assignedTechIds: ['t1'], createdBy: 'd2', jobTypeId: 'rekey', sourceId: 'google', serviceArea: 'North',
    totals: money(50),
  }),
  createMockDeal({
    id: 'c', createdAt: '2026-09-03T09:00:00.000Z', superStatus: JobSuperStatus.CANCELED,
    assignedTechIds: ['t2'], createdBy: 'd1', jobTypeId: 'lockout', sourceId: 'yelp', serviceArea: 'South',
    totals: money(999),
  }),
  createMockDeal({
    id: 'd', createdAt: '2026-09-03T11:00:00.000Z', superStatus: JobSuperStatus.SUBMITTED,
    assignedTechIds: [], createdBy: 'd1', jobTypeId: 'lockout', sourceId: undefined, serviceArea: 'South',
    totals: undefined,
  }),
];

describe('aggregateDealStats', () => {
  const stats = aggregateDealStats(deals, window, { money: true });

  it('counts every job in the window by status, canceled included', () => {
    expect(stats.jobs.total).toBe(4);
    expect(stats.jobs.byStatus).toMatchObject({ done: 1, in_progress: 1, canceled: 1, submitted: 1, pending: 0 });
  });

  it('sums the money of the jobs that were not canceled', () => {
    expect(stats.money).toEqual({
      revenue: 160,
      tax: 10,
      cost: 30,
      // revenue − tax − cost, as commissions count it
      profit: 120,
      // over the jobs that brought money
      avgSale: 80,
      // over the three days of the window
      avgPerDay: 53.33,
      pricedJobs: 2,
    });
  });

  it('lays jobs and revenue out day by day, empty days included', () => {
    expect(stats.series).toEqual([
      { date: '2026-09-01', jobs: 2, revenue: 160 },
      { date: '2026-09-02', jobs: 0, revenue: 0 },
      { date: '2026-09-03', jobs: 1, revenue: 0 },
    ]);
  });

  it('splits a shared job between its techs and ranks them by revenue', () => {
    expect(stats.byTech).toEqual([
      { key: 't1', jobs: 2, revenue: 105 },
      { key: 't2', jobs: 1, revenue: 55 },
    ]);
  });

  it('groups the live jobs by creator, job type, source and area; a job without one is under ""', () => {
    expect(stats.byCreator).toEqual([
      { key: 'd1', jobs: 2, revenue: 110 },
      { key: 'd2', jobs: 1, revenue: 50 },
    ]);
    expect(stats.byJobType).toEqual([
      { key: 'lockout', jobs: 2, revenue: 110 },
      { key: 'rekey', jobs: 1, revenue: 50 },
    ]);
    expect(stats.bySource).toEqual([
      { key: 'google', jobs: 2, revenue: 160 },
      { key: '', jobs: 1, revenue: 0 },
    ]);
    expect(stats.byServiceArea).toEqual([
      { key: 'North', jobs: 2, revenue: 160 },
      { key: 'South', jobs: 1, revenue: 0 },
    ]);
  });

  it('keys the series on the date the window is by', () => {
    const closed = aggregateDealStats(
      [createMockDeal({ superStatus: JobSuperStatus.DONE, createdAt: '2026-08-01T00:00:00.000Z', closedAt: '2026-09-02T12:00:00.000Z', totals: money(10) })],
      { by: 'closed', from: '2026-09-02', to: '2026-09-02' },
      { money: true },
    );
    expect(closed.series).toEqual([{ date: '2026-09-02', jobs: 1, revenue: 10 }]);

    const scheduled = aggregateDealStats(
      [createMockDeal({ scheduledDate: '2026-09-05', totals: money(10) })],
      { by: 'scheduled', from: '2026-09-05', to: '2026-09-05' },
      { money: true },
    );
    expect(scheduled.series).toEqual([{ date: '2026-09-05', jobs: 1, revenue: 10 }]);
  });

  it('leaves every amount out for a caller who may not see money', () => {
    const blind = aggregateDealStats(deals, window, { money: false });
    expect(blind.money).toBeUndefined();
    expect(blind.series[0]).toEqual({ date: '2026-09-01', jobs: 2 });
    expect(blind.byTech[0]).toEqual({ key: 't1', jobs: 2 });
  });

  it('is all zeros for an empty window', () => {
    const empty = aggregateDealStats([], window, { money: true });
    expect(empty.jobs.total).toBe(0);
    expect(empty.money).toMatchObject({ revenue: 0, avgSale: 0, avgPerDay: 0 });
    expect(empty.byTech).toEqual([]);
  });
});
