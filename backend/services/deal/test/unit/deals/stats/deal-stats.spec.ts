import { JobSuperStatus } from '@bitcrm/types';
import { aggregateDealStats } from 'src/deals/stats/deal-stats';
import { createMockAddress, createMockDeal } from '../../mocks';

const money = (total: number, tax = 0, cost = 0) => ({ subtotal: total - tax, discount: 0, tax, total, cost });

const window = { by: 'created' as const, from: '2026-09-01', to: '2026-09-03' };

const deals = [
  createMockDeal({
    id: 'a', createdAt: '2026-09-01T10:00:00.000Z', superStatus: JobSuperStatus.DONE,
    assignedTechIds: ['t1', 't2'], createdBy: 'd1', jobTypeId: 'lockout', sourceId: 'google', serviceArea: 'North',
    address: createMockAddress({ city: 'Atlanta', zip: '30301' }),
    totals: money(110, 10, 30),
  }),
  createMockDeal({
    id: 'b', createdAt: '2026-09-01T18:00:00.000Z', superStatus: JobSuperStatus.DONE,
    assignedTechIds: ['t1'], createdBy: 'd2', jobTypeId: 'rekey', sourceId: 'google', serviceArea: 'North',
    address: createMockAddress({ city: 'Atlanta', zip: '30302' }),
    totals: money(50),
  }),
  createMockDeal({
    id: 'c', createdAt: '2026-09-03T09:00:00.000Z', superStatus: JobSuperStatus.CANCELED,
    assignedTechIds: ['t2'], createdBy: 'd1', jobTypeId: 'lockout', sourceId: 'yelp', serviceArea: 'South',
    address: createMockAddress({ city: 'Decatur', zip: '30030' }),
    totals: money(999),
  }),
  createMockDeal({
    id: 'd', createdAt: '2026-09-03T11:00:00.000Z', superStatus: JobSuperStatus.IN_PROGRESS,
    assignedTechIds: [], createdBy: 'd1', jobTypeId: 'lockout', sourceId: undefined, serviceArea: 'South',
    address: createMockAddress({ city: 'Decatur', zip: '30030' }),
    // Priced but not done: not a sale yet.
    totals: money(70),
  }),
];

describe('aggregateDealStats', () => {
  const stats = aggregateDealStats(deals, window, { money: true });

  it('counts every job in the window by status', () => {
    expect(stats.jobs.total).toBe(4);
    expect(stats.jobs.byStatus).toMatchObject({ done: 2, in_progress: 1, canceled: 1, submitted: 0 });
  });

  it('sells what is Done — gross, profit and the averages come from Done jobs only (Workiz)', () => {
    expect(stats.money).toEqual({
      revenue: 160,
      tax: 10,
      cost: 30,
      // revenue − tax − cost, as commissions count it
      profit: 120,
      avgSale: 80,
      avgProfit: 60,
      // over the three days of the window
      avgPerDay: 53.33,
      doneJobs: 2,
    });
  });

  it('lays each day out: live jobs, canceled ones, and the day’s sales and profit', () => {
    expect(stats.series).toEqual([
      { date: '2026-09-01', jobs: 2, canceled: 0, revenue: 160, profit: 120 },
      { date: '2026-09-02', jobs: 0, canceled: 0, revenue: 0, profit: 0 },
      { date: '2026-09-03', jobs: 1, canceled: 1, revenue: 0, profit: 0 },
    ]);
  });

  it('gives each group all / done / open / canceled and its sales and profit', () => {
    expect(stats.bySource).toEqual([
      { key: 'google', all: 2, done: 2, open: 0, canceled: 0, revenue: 160, profit: 120 },
      { key: '', all: 1, done: 0, open: 1, canceled: 0, revenue: 0, profit: 0 },
      { key: 'yelp', all: 1, done: 0, open: 0, canceled: 1, revenue: 0, profit: 0 },
    ]);
    expect(stats.byCreator.map((b) => [b.key, b.all, b.done])).toEqual([
      ['d1', 3, 1],
      ['d2', 1, 1],
    ]);
  });

  it('credits every tech on a job with the job, and splits its money between them', () => {
    expect(stats.byTech).toEqual([
      { key: 't1', all: 2, done: 2, open: 0, canceled: 0, revenue: 105, profit: 85 },
      { key: 't2', all: 2, done: 1, open: 0, canceled: 1, revenue: 55, profit: 35 },
    ]);
  });

  it('drills areas down to city and zip', () => {
    expect(stats.byServiceArea.map((b) => [b.key, b.all])).toEqual([['North', 2], ['South', 2]]);
    expect(stats.byCity.map((b) => [b.key, b.all])).toEqual([['Atlanta', 2], ['Decatur', 2]]);
    // Ranked by sales, then by jobs.
    expect(stats.byZip.map((b) => [b.key, b.all])).toEqual([['30301', 1], ['30302', 1], ['30030', 2]]);
  });

  it('keys the series on the date the window is by', () => {
    const closed = aggregateDealStats(
      [createMockDeal({ superStatus: JobSuperStatus.DONE, createdAt: '2026-08-01T00:00:00.000Z', closedAt: '2026-09-02T12:00:00.000Z', totals: money(10) })],
      { by: 'closed', from: '2026-09-02', to: '2026-09-02' },
      { money: true },
    );
    expect(closed.series).toEqual([{ date: '2026-09-02', jobs: 1, canceled: 0, revenue: 10, profit: 10 }]);

    const scheduled = aggregateDealStats(
      [createMockDeal({ scheduledDate: '2026-09-05', superStatus: JobSuperStatus.SUBMITTED })],
      { by: 'scheduled', from: '2026-09-05', to: '2026-09-05' },
      { money: true },
    );
    expect(scheduled.series).toEqual([{ date: '2026-09-05', jobs: 1, canceled: 0, revenue: 0, profit: 0 }]);
  });

  it('leaves every amount out for a caller who may not see money', () => {
    const blind = aggregateDealStats(deals, window, { money: false });
    expect(blind.money).toBeUndefined();
    expect(blind.series[0]).toEqual({ date: '2026-09-01', jobs: 2, canceled: 0 });
    expect(blind.byTech[0]).toEqual({ key: 't1', all: 2, done: 2, open: 0, canceled: 0 });
    expect(JSON.stringify(blind)).not.toMatch(/revenue|profit/);
  });

  it('is all zeros for an empty window', () => {
    const empty = aggregateDealStats([], window, { money: true });
    expect(empty.jobs.total).toBe(0);
    expect(empty.money).toMatchObject({ revenue: 0, avgSale: 0, avgProfit: 0, avgPerDay: 0 });
    expect(empty.byTech).toEqual([]);
  });
});
