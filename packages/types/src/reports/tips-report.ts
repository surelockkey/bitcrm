import type { JobsReportPagination } from './jobs-report';

/**
 * The Workiz Tips report (`/root/tips`), shared by deal-service
 * (`GET /deals/report/tips`, `GET /deals/report/tips/jobs`) and the web page.
 *
 * Checked live on 2026-09-30 (parser `docs/reports/tips.md`):
 *
 * - one row per person assigned to at least one job of the period — "Tech",
 *   "Tip total", "Jobs" — and nothing else: no totals row, no chart;
 * - the period is on the **job date** (the visit's start, account calendar,
 *   both days included); there is no "By:" — and it is not the payment date;
 * - every job counts, whatever its status — Canceled too; only deleted jobs
 *   and jobs nobody is assigned to are out;
 * - a job's tip is the job's own tip (Workiz `tip_amount`, what the payments
 *   brought in as tips), split **equally** between everyone on the job:
 *   $64.61 on a two-person job is $32.305 each, and each of them counts the
 *   job once in "Jobs";
 * - a row opens into that person's jobs of the period: Job ID, Job name,
 *   Client, Date, Job type, Total amount (the whole job), Tip (their share).
 */

/** Rows per page of a person's jobs — Workiz's inner table, which has no size choice. */
export const TIPS_REPORT_JOBS_PAGE_SIZE = 10;
/** The largest page of a person's jobs one request may ask for. */
export const TIPS_REPORT_JOBS_MAX_PAGE_SIZE = 1000;
/** The longest period one request may cover — the Jobs report's limit, on the same window read. */
export const TIPS_REPORT_MAX_DAYS = 366;

/**
 * The multi-filter ("Filter results"): Tech, Job type, Client — OR inside a
 * group, AND between groups. Tech keeps the rows of those people; Job type
 * and Client keep the jobs of those types / clients. A job's tip is still
 * split between EVERYONE on it, filtered or not.
 */
export interface TipsReportFilters {
  techId?: string[];
  jobTypeId?: string[];
  contactId?: string[];
}

/** One person's line. */
export interface TipsReportRow {
  techId: string;
  /** Empty when user-service could not name them. */
  name: string;
  /** Dollars, their shares summed and then rounded to the cent. `null` without `financials.view`. */
  tips: number | null;
  /** Jobs of the period they are on. */
  jobs: number;
}

/**
 * Every person of the period at once — never more than the team — so the
 * page sorts, searches, pages and exports them itself, like Workiz's table.
 */
export interface TipsReportPage {
  rows: TipsReportRow[];
  window: { from: string; to: string };
  /** False when money is withheld from this caller (no `financials.view`). */
  money: boolean;
}

/** The columns of a person's jobs, in Workiz's order. */
export const TIPS_REPORT_JOB_COLUMNS = [
  { id: 'job', label: 'Job ID' },
  { id: 'jobName', label: 'Job name' },
  { id: 'client', label: 'Client' },
  { id: 'date', label: 'Date' },
  { id: 'jobType', label: 'Job type' },
  { id: 'total', label: 'Total amount' },
  { id: 'tip', label: 'Tip' },
] as const;

export type TipsReportJobSort = (typeof TIPS_REPORT_JOB_COLUMNS)[number]['id'] | 'default';

export const TIPS_REPORT_JOB_SORTS: readonly TipsReportJobSort[] = ['default', ...TIPS_REPORT_JOB_COLUMNS.map((c) => c.id)];

/** One job in a person's list. */
export interface TipsReportJobRow {
  dealId: string;
  jobNumber: string;
  jobName?: string;
  contactId: string;
  client: string;
  /** The job date on the account's wall clock: `YYYY-MM-DDTHH:MM` (or a bare day). */
  date?: string;
  jobTypeId?: string;
  jobType: string;
  /** The whole job's total, dollars. `null` without `financials.view`. */
  total: number | null;
  /** This person's share of the job's tip, rounded to the cent. `null` without `financials.view`. */
  tip: number | null;
  /** How many people the tip was split between. */
  people: number;
}

export interface TipsReportJobsPage {
  techId: string;
  rows: TipsReportJobRow[];
  pagination: JobsReportPagination;
  sort: { column: TipsReportJobSort; dir: 'asc' | 'desc' };
  money: boolean;
}
