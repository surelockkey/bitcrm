import { JobSuperStatus, type JobsReportBy, type JobsReportFilters } from '@bitcrm/types';
import { inWindow, isReportable, matchesFilters, type ReportDeal } from './jobs-report.logic';

/**
 * The figures the Jobs report's own rows add up to over a period — what the
 * Workiz report was checked against live (`docs/reports/jobs.md`,
 * «Перевірочні числа»): how many rows, Σ Total over all of them and over the
 * Done ones, Σ amount due, and how many of each status.
 */
export interface JobsReportSummary {
  by: JobsReportBy;
  from: string;
  to: string;
  rows: number;
  total: number;
  doneTotal: number;
  amountDue: number;
  byStatus: Record<JobSuperStatus, number>;
  origin: { lead: number; new: number };
  ids: string[];
}

const cents = (n: number): number => Math.round(n * 100) / 100;

export function summarizeJobsReport(
  deals: Iterable<ReportDeal>,
  by: JobsReportBy,
  from: string,
  to: string,
  filters: JobsReportFilters = {},
): JobsReportSummary {
  const byStatus = Object.fromEntries(Object.values(JobSuperStatus).map((s) => [s, 0])) as Record<JobSuperStatus, number>;
  const out: JobsReportSummary = { by, from, to, rows: 0, total: 0, doneTotal: 0, amountDue: 0, byStatus, origin: { lead: 0, new: 0 }, ids: [] };
  let total = 0;
  let doneTotal = 0;
  let due = 0;
  for (const d of deals) {
    if (!isReportable(d) || !inWindow(d, by, from, to) || !matchesFilters(d, filters)) continue;
    out.rows += 1;
    out.ids.push(d.id);
    total += Math.round(d.total * 100);
    due += Math.round((d.amountDue ?? 0) * 100);
    if (d.superStatus === JobSuperStatus.DONE) doneTotal += Math.round(d.total * 100);
    byStatus[d.superStatus] = (byStatus[d.superStatus] ?? 0) + 1;
    out.origin[d.origin] += 1;
  }
  out.total = cents(total / 100);
  out.doneTotal = cents(doneTotal / 100);
  out.amountDue = cents(due / 100);
  return out;
}
