import { Injectable, Logger, Optional } from '@nestjs/common';
import { dashboardDay } from '@bitcrm/types';
import { CommissionReportService } from '../../commission-report/commission-report.service';
import { JobsReportService } from './jobs-report.service';
import { JobStatisticsService } from './job-statistics.service';
import { TaxReportService } from './tax-report.service';
import { shiftDay } from './report-dates';

interface Period {
  from: string;
  to: string;
}

/**
 * The settled periods the office opens most, on the account's calendar
 * (America/New_York): last Monday–Sunday week (the weekly settlement) and last
 * calendar month (month-end figures).
 */
export function settledPeriods(now: Date): { lastWeek: Period; lastMonth: Period } {
  const today = dashboardDay(now);
  // getUTCDay of the calendar day: 0 is Sunday, which closes the Monday week.
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const thisMonday = shiftDay(today, -((weekday + 6) % 7));
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const lastOfPrevious = shiftDay(firstOfMonth, -1);
  return {
    lastWeek: { from: shiftDay(thisMonday, -7), to: shiftDay(thisMonday, -1) },
    lastMonth: { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious },
  };
}

/**
 * The nightly warm of the reports' shared window cache (`ReportWindowCache`),
 * run by `DashboardSnapshotScheduler` under its Redis day-lock — one task a
 * night, right after the dashboard snapshots.
 *
 * Only SETTLED periods: a window that reaches today lives five minutes in the
 * cache, so warming the reports' opening periods (this week, this month,
 * today) at 3 AM would be gone before anyone looks. What is warmed is what
 * the office opens next: last week and last month — Jobs report on the
 * account's saved "By:", Job Statistics and Tax on "Job end date" (what they
 * open on), commissions on "Closed" office-wide.
 *
 * One window at a time — there is no one to hurry for at 3 AM, only a table
 * not to hammer. A window that fails is logged and counted; the rest still warm.
 */
@Injectable()
export class ReportWindowWarmer {
  private readonly logger = new Logger(ReportWindowWarmer.name);

  constructor(
    private readonly jobs: JobsReportService,
    private readonly stats: JobStatisticsService,
    private readonly tax: TaxReportService,
    @Optional() private readonly commissions?: CommissionReportService,
  ) {}

  async warm(now: Date): Promise<{ warmed: number; failed: number }> {
    const { lastWeek, lastMonth } = settledPeriods(now);
    const jobsBy = await this.jobs.defaultBy().catch(() => 'end' as const);
    const steps: Array<[string, () => Promise<void>]> = [];
    for (const p of [lastWeek, lastMonth]) steps.push([`jobs ${jobsBy} ${p.from}..${p.to}`, () => this.jobs.warmWindow(jobsBy, p.from, p.to)]);
    for (const p of [lastWeek, lastMonth]) steps.push([`stats end ${p.from}..${p.to}`, () => this.stats.warmWindow('end', p.from, p.to)]);
    steps.push([`tax end ${lastMonth.from}..${lastMonth.to}`, () => this.tax.warmWindow('end', lastMonth.from, lastMonth.to)]);
    if (this.commissions) {
      const commissions = this.commissions;
      for (const p of [lastWeek, lastMonth]) {
        steps.push([`commissions closed ${p.from}..${p.to}`, () => commissions.warmPeriod('closed', p.from, p.to)]);
      }
    }

    let warmed = 0;
    let failed = 0;
    for (const [what, run] of steps) {
      try {
        await run();
        warmed += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(`report window warm: ${what} failed: ${(err as Error).message}`);
      }
    }
    return { warmed, failed };
  }
}
