import {
  JobSuperStatus,
  type Deal,
  type DealStats,
  type DealStatsBucket,
  type DealStatsBy,
} from '@bitcrm/types';

export interface DealStatsWindow {
  by: DealStatsBy;
  from: string;
  to: string;
}

const cents = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : 0;
const dollars = (c: number): number => Math.round(c) / 100;

/** The day a job sits on in a window "by" that date. */
function dayOf(deal: Deal, by: DealStatsBy): string | undefined {
  if (by === 'scheduled') return deal.scheduledDate;
  if (by === 'closed') return deal.closedAt?.slice(0, 10);
  return deal.createdAt?.slice(0, 10);
}

function daysOf(window: DealStatsWindow): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${window.from}T00:00:00Z`); t <= Date.parse(`${window.to}T00:00:00Z`); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** A breakdown: jobs and revenue (in cents) per key. */
class Buckets {
  private readonly rows = new Map<string, { jobs: number; cents: number }>();

  add(key: string | undefined, jobs: number, revenueCents: number): void {
    const row = this.rows.get(key ?? '') ?? { jobs: 0, cents: 0 };
    row.jobs += jobs;
    row.cents += revenueCents;
    this.rows.set(key ?? '', row);
  }

  /** Ranked by revenue when it is shown, else by jobs; ties by key. */
  list(money: boolean): DealStatsBucket[] {
    return [...this.rows.entries()]
      .sort(([ka, a], [kb, b]) => (money ? b.cents - a.cents : 0) || b.jobs - a.jobs || ka.localeCompare(kb))
      .map(([key, r]) => (money ? { key, jobs: r.jobs, revenue: dollars(r.cents) } : { key, jobs: r.jobs }));
  }
}

/**
 * A window of jobs at a glance. Counts cover every job; the money and the
 * breakdowns leave canceled jobs out. A job shared by several techs splits
 * its revenue between them equally (whole cents, remainder to the first),
 * so the tech column adds up to the total.
 */
export function aggregateDealStats(
  deals: Deal[],
  window: DealStatsWindow,
  opts: { money: boolean },
): DealStats {
  const byStatus = Object.fromEntries(
    Object.values(JobSuperStatus).map((s) => [s, 0]),
  ) as Record<JobSuperStatus, number>;
  const days = daysOf(window);
  const series = new Map(days.map((d) => [d, { jobs: 0, cents: 0 }]));
  const byTech = new Buckets();
  const byCreator = new Buckets();
  const byJobType = new Buckets();
  const bySource = new Buckets();
  const byServiceArea = new Buckets();
  let revenue = 0;
  let tax = 0;
  let cost = 0;
  let pricedJobs = 0;

  for (const deal of deals) {
    if (deal.superStatus) byStatus[deal.superStatus] = (byStatus[deal.superStatus] ?? 0) + 1;
    if (deal.superStatus === JobSuperStatus.CANCELED) continue;

    const total = cents(deal.totals?.total);
    revenue += total;
    tax += cents(deal.totals?.tax);
    cost += cents(deal.totals?.cost);
    if (total > 0) pricedJobs++;

    const day = series.get(dayOf(deal, window.by) ?? '');
    if (day) {
      day.jobs++;
      day.cents += total;
    }

    const techs = deal.assignedTechIds ?? [];
    const share = techs.length ? Math.floor(total / techs.length) : 0;
    techs.forEach((t, i) => byTech.add(t, 1, share + (i === 0 ? total - share * techs.length : 0)));
    byCreator.add(deal.createdBy, 1, total);
    byJobType.add(deal.jobTypeId, 1, total);
    bySource.add(deal.sourceId, 1, total);
    byServiceArea.add(deal.serviceArea, 1, total);
  }

  const money = opts.money;
  return {
    window,
    jobs: { total: deals.length, byStatus },
    ...(money && {
      money: {
        revenue: dollars(revenue),
        tax: dollars(tax),
        cost: dollars(cost),
        profit: dollars(revenue - tax - cost),
        avgSale: pricedJobs ? dollars(revenue / pricedJobs) : 0,
        avgPerDay: days.length ? dollars(revenue / days.length) : 0,
        pricedJobs,
      },
    }),
    series: days.map((date) => {
      const d = series.get(date)!;
      return money ? { date, jobs: d.jobs, revenue: dollars(d.cents) } : { date, jobs: d.jobs };
    }),
    byTech: byTech.list(money),
    byCreator: byCreator.list(money),
    byJobType: byJobType.list(money),
    bySource: bySource.list(money),
    byServiceArea: byServiceArea.list(money),
  };
}
