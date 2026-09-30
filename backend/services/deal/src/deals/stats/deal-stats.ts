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

type Outcome = 'done' | 'open' | 'canceled';

const outcomeOf = (deal: Deal): Outcome =>
  deal.superStatus === JobSuperStatus.DONE
    ? 'done'
    : deal.superStatus === JobSuperStatus.CANCELED
      ? 'canceled'
      : 'open';

/** A breakdown: counts by outcome and the Done jobs' money, in cents, per key. */
class Buckets {
  private readonly rows = new Map<string, { done: number; open: number; canceled: number; sales: number; profit: number }>();

  add(key: string | undefined, outcome: Outcome, salesCents: number, profitCents: number): void {
    const k = key ?? '';
    const row = this.rows.get(k) ?? { done: 0, open: 0, canceled: 0, sales: 0, profit: 0 };
    row[outcome]++;
    row.sales += salesCents;
    row.profit += profitCents;
    this.rows.set(k, row);
  }

  /** Ranked by sales when they are shown, then by jobs; ties by key. */
  list(money: boolean): DealStatsBucket[] {
    const all = (r: { done: number; open: number; canceled: number }) => r.done + r.open + r.canceled;
    return [...this.rows.entries()]
      .sort(([ka, a], [kb, b]) => (money ? b.sales - a.sales : 0) || all(b) - all(a) || ka.localeCompare(kb))
      .map(([key, r]) => ({
        key,
        all: all(r),
        done: r.done,
        open: r.open,
        canceled: r.canceled,
        ...(money && { revenue: dollars(r.sales), profit: dollars(r.profit) }),
      }));
  }
}

/** `total` split into `n` whole-cent shares, the remainder on the first. */
function shares(total: number, n: number): number[] {
  const share = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => share + (i === 0 ? total - share * n : 0));
}

/**
 * A window of jobs at a glance, the Workiz Job Statistics way: every job
 * counts toward all / done / open / canceled; only Done jobs are sales.
 * Profit is revenue − tax − company cost of the lines. A job shared by
 * several techs counts as a job for each of them and splits its money
 * between them equally, so the tech column adds up to the total.
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
  const series = new Map(days.map((d) => [d, { jobs: 0, canceled: 0, sales: 0, profit: 0 }]));
  const byTech = new Buckets();
  const byCreator = new Buckets();
  const byJobType = new Buckets();
  const bySource = new Buckets();
  const byServiceArea = new Buckets();
  const byCity = new Buckets();
  const byZip = new Buckets();
  let revenue = 0;
  let tax = 0;
  let cost = 0;
  let doneJobs = 0;

  for (const deal of deals) {
    if (deal.superStatus) byStatus[deal.superStatus] = (byStatus[deal.superStatus] ?? 0) + 1;
    const outcome = outcomeOf(deal);
    const done = outcome === 'done';
    const sales = done ? cents(deal.totals?.total) : 0;
    const dealTax = done ? cents(deal.totals?.tax) : 0;
    const dealCost = done ? cents(deal.totals?.cost) : 0;
    const profit = sales - dealTax - dealCost;
    if (done) {
      doneJobs++;
      revenue += sales;
      tax += dealTax;
      cost += dealCost;
    }

    const day = series.get(dayOf(deal, window.by) ?? '');
    if (day) {
      if (outcome === 'canceled') day.canceled++;
      else day.jobs++;
      day.sales += sales;
      day.profit += profit;
    }

    const techs = deal.assignedTechIds ?? [];
    if (techs.length) {
      const salesShares = shares(sales, techs.length);
      const profitShares = shares(profit, techs.length);
      techs.forEach((t, i) => byTech.add(t, outcome, salesShares[i], profitShares[i]));
    }
    byCreator.add(deal.createdBy, outcome, sales, profit);
    byJobType.add(deal.jobTypeId, outcome, sales, profit);
    bySource.add(deal.sourceId, outcome, sales, profit);
    byServiceArea.add(deal.serviceArea, outcome, sales, profit);
    byCity.add(deal.address?.city, outcome, sales, profit);
    byZip.add(deal.address?.zip, outcome, sales, profit);
  }

  const money = opts.money;
  const profit = revenue - tax - cost;
  return {
    window,
    jobs: { total: deals.length, byStatus },
    ...(money && {
      money: {
        revenue: dollars(revenue),
        tax: dollars(tax),
        cost: dollars(cost),
        profit: dollars(profit),
        avgSale: doneJobs ? dollars(revenue / doneJobs) : 0,
        avgProfit: doneJobs ? dollars(profit / doneJobs) : 0,
        avgPerDay: days.length ? dollars(revenue / days.length) : 0,
        doneJobs,
      },
    }),
    series: days.map((date) => {
      const d = series.get(date)!;
      return {
        date,
        jobs: d.jobs,
        canceled: d.canceled,
        ...(money && { revenue: dollars(d.sales), profit: dollars(d.profit) }),
      };
    }),
    byTech: byTech.list(money),
    byCreator: byCreator.list(money),
    byJobType: byJobType.list(money),
    bySource: bySource.list(money),
    byServiceArea: byServiceArea.list(money),
    byCity: byCity.list(money),
    byZip: byZip.list(money),
  };
}
