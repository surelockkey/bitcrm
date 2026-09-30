import { JOB_STATISTICS_TABS } from '@bitcrm/types';
import {
  STATS_PROJECTION,
  aggregateJobStatistics,
  areaGroup,
  daysOf,
  dispatcherGroup,
  emptyStatsLookups,
  sourceGroup,
  techGroup,
  toStatsDeal,
  type StatsDeal,
  type StatsOptions,
} from 'src/deals/report/job-statistics.logic';
import { REPORT_PROJECTION } from 'src/deals/report/jobs-report.logic';

let seq = 0;
/** A deal row shaped like the Workiz import (the attributes the statistics read). */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  seq += 1;
  return {
    id: `d${seq}`,
    status: 'active',
    dealNumber: `N${seq}`,
    contactId: 'c1',
    tagIds: [],
    jobTypeId: 'jt1',
    createdAt: '2026-08-20T21:28:20.000Z',
    scheduledDate: '2026-09-04',
    scheduledEndDate: '2026-09-04',
    scheduledTimeSlot: '16:00-17:39',
    allDay: false,
    jobTimezone: 'America/Chicago',
    jobDateUtc: '2026-09-04T21:00:00.000Z',
    jobEndDateUtc: '2026-09-04T22:39:00.000Z',
    superStatus: 'done',
    assignedTechIds: ['t1'],
    createdBy: 'u1',
    address: { city: 'Long Grove', zip: '60047' },
    serviceArea: 'SURE LOCK IL',
    serviceAreaId: 'sa1',
    totals: { total: 270, tax: 0, source: 'workiz' },
    jobTotalPrice: 270,
    sourceId: 's1',
    parts: 20,
    totalLabourCost: 0,
    commissionSnapshot: { companyProfit: 125, techProfit: 125, total: 270, parts: 20 },
    ...over,
  };
};

const lookups = () => {
  const lk = emptyStatsLookups();
  lk.users.set('t1', 'Amnon Maggid').set('t2', 'Ricky Sledge').set('u1', 'Kendall');
  lk.sources
    .set('s1', { name: 'GMB IL', description: 'ALL GMB CALLS' })
    .set('s2', { name: 'A-1 CT', description: 'transferred from A1 account' })
    .set('s3', { name: 'A-1 CT 2', description: 'transferred from A1 account' })
    .set('s4', { name: 'Yelp' });
  lk.externalCompanies.set('e1', 'Papas Lock Out Service');
  lk.serviceAreas.set('sa1', 'SURE LOCK IL').set('sa2', 'SURE LOCK CT');
  lk.jobTypes.set('jt1', 'Car key');
  return lk;
};

const ALL: StatsOptions = { money: true, profit: true, tabs: JOB_STATISTICS_TABS };
const window = { by: 'end' as const, from: '2026-09-01', to: '2026-09-05' };

describe('toStatsDeal', () => {
  it('takes a Done imported job’s profit from Workiz’s frozen Commissions row', () => {
    const d = toStatsDeal(row());
    expect(d).toMatchObject({ superStatus: 'done', total: 270, parts: 20, laborCost: 0, profit: 125, profitSource: 'workiz' });
    expect(d.pending).toBeUndefined();
  });

  it('marks a Done job without a Workiz row as still to be computed, and keeps its raw row for the formula', () => {
    const item = row({ commissionSnapshot: undefined });
    const d = toStatsDeal(item);
    expect(d.profit).toBeUndefined();
    expect(d.pending).toBe(item);
  });

  it('never asks for a profit of a job that is not Done', () => {
    const d = toStatsDeal(row({ superStatus: 'canceled', commissionSnapshot: undefined }));
    expect(d.profit).toBeUndefined();
    expect(d.pending).toBeUndefined();
  });

  it('reads everything the Jobs report reads, plus the money', () => {
    expect(STATS_PROJECTION).toEqual(expect.arrayContaining([...REPORT_PROJECTION, 'commissionSnapshot', 'parts', 'totalLabourCost', 'taxAmount']));
    expect(new Set(STATS_PROJECTION).size).toBe(STATS_PROJECTION.length);
  });
});

describe('groups', () => {
  const lk = lookups();

  it('Sources: the ad group’s description, else its name; one row per description; a company is its own row', () => {
    expect(sourceGroup(toStatsDeal(row()), lk)).toEqual({ key: 'ad:ALL GMB CALLS', label: 'ALL GMB CALLS', kind: 'ad' });
    expect(sourceGroup(toStatsDeal(row({ sourceId: 's2' })), lk).key).toBe(sourceGroup(toStatsDeal(row({ sourceId: 's3' })), lk).key);
    expect(sourceGroup(toStatsDeal(row({ sourceId: 's4' })), lk).label).toBe('Yelp');
    expect(sourceGroup(toStatsDeal(row({ externalCompanyId: 'e1' })), lk)).toEqual({
      key: 'external:e1',
      label: 'Papas Lock Out Service',
      kind: 'external',
    });
    // A source the catalog does not know stays its own row, never merged into another.
    expect(sourceGroup(toStatsDeal(row({ sourceId: 'gone' })), lk)).toEqual({ key: 'ad-id:gone', label: '', kind: 'ad' });
  });

  it('Tech: the whole team is one "A + B" row in assignment order; nobody is "unassigned"', () => {
    expect(techGroup(toStatsDeal(row({ assignedTechIds: ['t2', 't1'] })), lk)).toEqual({
      key: 'tech:t2+t1',
      label: 'Ricky Sledge + Amnon Maggid',
      techIds: ['t2', 't1'],
    });
    expect(techGroup(toStatsDeal(row({ assignedTechIds: [] })), lk)).toEqual({ key: 'unassigned', label: '', techIds: [] });
  });

  it('Area: by the job’s service area; a job without one is in no area row', () => {
    expect(areaGroup(toStatsDeal(row()), lk)).toEqual({ key: 'area:sa1', label: 'SURE LOCK IL' });
    expect(areaGroup(toStatsDeal(row({ serviceAreaId: undefined })), lk)).toEqual({ key: 'area-name:SURE LOCK IL', label: 'SURE LOCK IL' });
    expect(areaGroup(toStatsDeal(row({ serviceAreaId: undefined, serviceArea: '' })), lk)).toBeUndefined();
  });

  it('Dispatcher: the creator, or Workiz’s own "Created by" text when BitCRM has no such user', () => {
    expect(dispatcherGroup(toStatsDeal(row()), lk)).toEqual({ key: 'user:u1', label: 'Kendall' });
    expect(dispatcherGroup(toStatsDeal(row({ createdBy: 'gone', userCreated: '(1) (Mia) 7 Dispatcher' })), lk)).toEqual({
      key: 'text:(1) (Mia) 7 Dispatcher',
      label: '(1) (Mia) 7 Dispatcher',
    });
  });
});

describe('aggregateJobStatistics', () => {
  const deals = (): StatsDeal[] =>
    [
      row(),
      row({ assignedTechIds: ['t1', 't2'], totals: { total: 320 }, jobTotalPrice: 320, parts: 65, commissionSnapshot: { companyProfit: 140.25 } }),
      row({ superStatus: 'canceled', commissionSnapshot: undefined, parts: 0, assignedTechIds: [] }),
      row({ superStatus: 'pending', commissionSnapshot: undefined, parts: 0, scheduledDate: '2026-09-05', scheduledEndDate: '2026-09-05', jobDateUtc: undefined, jobEndDateUtc: undefined, scheduledTimeSlot: '10:00-12:00' }),
      row({ superStatus: 'submitted', commissionSnapshot: undefined, parts: 0, serviceAreaId: undefined, serviceArea: '' }),
      row({ superStatus: 'in_progress', commissionSnapshot: undefined, parts: 0, sourceId: 's2' }),
    ].map(toStatsDeal);

  it('counts every job and sells only the Done ones — Workiz’s KPIs', () => {
    const s = aggregateJobStatistics(deals(), window, lookups(), ALL);
    expect(s.kpis).toEqual({
      all: 6,
      done: 2,
      open: 3,
      canceled: 1,
      canceledPct: 16.67,
      submitted: 1,
      inProgress: 1,
      pending: 1,
      donePendingApproval: 0,
      gross: 590,
      profit: 265.25,
      laborCost: 0,
      techExpenses: 85,
      avgSale: 295,
      avgProfit: 132.63,
    });
    expect(s.profitSources).toEqual({ workiz: 2, computed: 0 });
  });

  it('draws every day of the window; its Jobs bar holds the canceled jobs too', () => {
    const s = aggregateJobStatistics(deals(), window, lookups(), ALL);
    expect(s.series.map((d) => d.date)).toEqual(daysOf('2026-09-01', '2026-09-05'));
    expect(s.series.find((d) => d.date === '2026-09-04')).toEqual({ date: '2026-09-04', jobs: 5, canceled: 1, done: 2, sales: 590, profit: 265.25 });
    expect(s.series.find((d) => d.date === '2026-09-05')).toMatchObject({ jobs: 1, canceled: 0, done: 0, sales: 0 });
    expect(s.series.find((d) => d.date === '2026-09-01')).toEqual({ date: '2026-09-01', jobs: 0, canceled: 0, done: 0, sales: 0, profit: 0 });
  });

  it('gives each tech combination one row, with labor and tech expenses, adding up to All', () => {
    const { tech } = aggregateJobStatistics(deals(), window, lookups(), ALL);
    const byLabel = new Map(tech!.rows.map((r) => [r.label, r]));
    expect(byLabel.get('Amnon Maggid')).toMatchObject({ all: 4, done: 1, open: 3, canceled: 0, gross: 270, profit: 125, techExpenses: 20, laborCost: 0 });
    expect(byLabel.get('Amnon Maggid + Ricky Sledge')).toMatchObject({ all: 1, done: 1, gross: 320, profit: 140.25, techExpenses: 65 });
    expect(tech!.rows.find((r) => r.key === 'unassigned')).toMatchObject({ all: 1, canceled: 1, canceledPct: 100, techIds: [] });
    expect(tech!.rows.reduce((n, r) => n + r.all, 0)).toBe(6);
    expect(tech!.totals).toMatchObject({ all: 6, done: 2, gross: 590, profit: 265.25, techExpenses: 85 });
  });

  it('leaves jobs without a service area out of all three Area drills, and says how many', () => {
    const { area } = aggregateJobStatistics(deals(), window, lookups(), ALL);
    expect(area!.withoutArea).toBe(1);
    expect(area!.metro.totals.all).toBe(5);
    expect(area!.city.rows).toEqual([expect.objectContaining({ label: 'Long Grove', serviceArea: 'SURE LOCK IL', all: 5 })]);
    expect(area!.zip.rows).toEqual([expect.objectContaining({ label: '60047', city: 'Long Grove', all: 5 })]);
  });

  it('keeps the money out without financials.view, and the profit out without View Profit', () => {
    const counts = aggregateJobStatistics(deals(), window, lookups(), { ...ALL, money: false, profit: false });
    expect(counts.kpis).not.toHaveProperty('gross');
    expect(counts.kpis).not.toHaveProperty('profit');
    expect(counts.series[3]).not.toHaveProperty('sales');
    expect(counts.sources!.rows[0]).not.toHaveProperty('gross');
    expect(counts.profitSources).toBeUndefined();

    const sales = aggregateJobStatistics(deals(), window, lookups(), { ...ALL, profit: false });
    expect(sales.kpis).toMatchObject({ gross: 590, avgSale: 295 });
    expect(sales.kpis).not.toHaveProperty('profit');
    expect(sales.kpis).not.toHaveProperty('avgProfit');
    expect(sales.tech!.rows[0]).not.toHaveProperty('profit');
    expect(sales.series[3]).toHaveProperty('sales');
    expect(sales.series[3]).not.toHaveProperty('profit');
  });

  it('builds only the tables the caller may open', () => {
    const s = aggregateJobStatistics(deals(), window, lookups(), { ...ALL, tabs: ['tech'] });
    expect(s.tech).toBeDefined();
    expect(s.sources).toBeUndefined();
    expect(s.area).toBeUndefined();
    expect(s.dispatcher).toBeUndefined();
    expect(s.jobTypes).toBeUndefined();
  });

  it('adds money up in whole cents, never drifting over thousands of jobs', () => {
    const many = Array.from({ length: 3000 }, () =>
      toStatsDeal(row({ totals: { total: 0.1 }, jobTotalPrice: 0.1, commissionSnapshot: { companyProfit: 0.07 }, parts: 0.01 })),
    );
    const s = aggregateJobStatistics(many, window, lookups(), ALL);
    expect(s.kpis.gross).toBe(300);
    expect(s.kpis.profit).toBe(210);
    expect(s.kpis.techExpenses).toBe(30);
  });

  it('counts a Done job whose profit is computed under "computed"', () => {
    const d = toStatsDeal(row({ commissionSnapshot: undefined }));
    d.profit = 99.5;
    d.profitSource = 'computed';
    const s = aggregateJobStatistics([d], window, lookups(), ALL);
    expect(s.kpis.profit).toBe(99.5);
    expect(s.profitSources).toEqual({ workiz: 0, computed: 1 });
  });

  it('sorts a table most jobs first', () => {
    const { sources } = aggregateJobStatistics(deals(), window, lookups(), ALL);
    expect(sources!.rows.map((r) => r.label)).toEqual(['ALL GMB CALLS', 'transferred from A1 account']);
    expect(sources!.rows.map((r) => r.all)).toEqual([5, 1]);
  });
});
