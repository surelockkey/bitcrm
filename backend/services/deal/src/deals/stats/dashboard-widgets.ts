import {
  JobSuperStatus,
  type DashboardJobsNow,
  type DashboardSales,
  type DashboardScoreRow,
  type DashboardShare,
  type DashboardToday,
  type DealStats,
  type DealStatsBucket,
} from '@bitcrm/types';

/**
 * The dashboard's widgets are slices of `/deals/stats`, never counts of their
 * own: the dashboard and the Job Statistics report read the same aggregate,
 * so the two cannot disagree about a period.
 */

/** Workiz draws four slices; the legend is a two-by-two grid. */
const PIE_SLICES = 4;
/** A scoreboard is a glance, not the report — that is one click away. */
const SCOREBOARD_ROWS = 5;

const toCents = (n: number | undefined): number => Math.round((n ?? 0) * 100);

/**
 * The top slices of a breakdown, by jobs. `percent` is each one's share of
 * the slices shown, which is how Workiz labels its pies — theirs add up to
 * 100 with four slices on the chart.
 *
 * Jobs with nothing under the key are left out: "no source" is not a source,
 * and a pie led by it says nothing about where the work came from.
 */
export function topShares(
  buckets: DealStatsBucket[],
  names: Record<string, string | undefined>,
): DashboardShare[] {
  const top = buckets
    .filter((b) => b.key && b.all > 0)
    // Ties by key, so an equal pair does not swap places on every refresh.
    .sort((a, b) => b.all - a.all || a.key.localeCompare(b.key))
    .slice(0, PIE_SLICES);
  const sum = top.reduce((n, b) => n + b.all, 0);
  return top.map((b) => ({
    key: b.key,
    name: names[b.key] ?? b.key,
    count: b.all,
    percent: Math.round((b.all / sum) * 10_000) / 100,
  }));
}

/** "Sales": billed (Total) and what is left after tax and cost (Net), per day. */
export function salesOf(stats: DealStats): DashboardSales {
  const days = stats.series.map((d) => ({ date: d.date, total: d.revenue ?? 0, net: d.profit ?? 0 }));
  // Summed in cents: the header shows the total to the cent, and float
  // addition across a quarter of days drifts.
  const total = days.reduce((c, d) => c + toCents(d.total), 0);
  const net = days.reduce((c, d) => c + toCents(d.net), 0);
  return { days, total: total / 100, net: net / 100 };
}

/**
 * A scoreboard: who sold the most in the window. Jobs are the Done ones —
 * a sale is a Done job — so a person with none is not on the board.
 * Without money the ranking falls back to jobs and no amount is sent.
 */
export function scoreboardOf(
  buckets: DealStatsBucket[],
  names: Record<string, string | undefined>,
  money: boolean,
): DashboardScoreRow[] {
  return buckets
    .filter((b) => b.key && b.done > 0)
    .sort(
      (a, b) =>
        (money ? (b.revenue ?? 0) - (a.revenue ?? 0) : 0) || b.done - a.done || a.key.localeCompare(b.key),
    )
    .slice(0, SCOREBOARD_ROWS)
    .map((b) => ({
      id: b.key,
      name: names[b.key] ?? '',
      jobs: b.done,
      ...(money && { sales: b.revenue ?? 0 }),
    }));
}

/**
 * "Today": what closed today and what was opened today. The two are different
 * windows — a job created last week and finished this morning is today's sale,
 * not today's new job — so they come from two aggregates.
 */
export function todayOf(closedToday: DealStats, createdToday: DealStats): DashboardToday {
  return {
    ...(closedToday.money && { sales: closedToday.money.revenue }),
    jobsDone: closedToday.jobs.byStatus[JobSuperStatus.DONE] ?? 0,
    jobsCanceled: closedToday.jobs.byStatus[JobSuperStatus.CANCELED] ?? 0,
    jobsCreated: createdToday.jobs.total,
  };
}

/** "Jobs": the four states work waits in. A count that could not be had reads as zero. */
export function jobsNowOf(byStatus: Record<JobSuperStatus, number | null>): DashboardJobsNow {
  return {
    byStatus: {
      [JobSuperStatus.SUBMITTED]: byStatus[JobSuperStatus.SUBMITTED] ?? 0,
      [JobSuperStatus.PENDING]: byStatus[JobSuperStatus.PENDING] ?? 0,
      [JobSuperStatus.IN_PROGRESS]: byStatus[JobSuperStatus.IN_PROGRESS] ?? 0,
      [JobSuperStatus.DONE_PENDING_APPROVAL]: byStatus[JobSuperStatus.DONE_PENDING_APPROVAL] ?? 0,
    },
  };
}
