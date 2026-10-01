import { type JobsReportBy } from './jobs-report';

/**
 * The Workiz Job Statistics report (`/root/statistics_report/`), shared by
 * deal-service (`GET /deals/report/statistics`) and the web page.
 *
 * A period's jobs as aggregates only — no job rows: six KPIs, a day series
 * and one table per breakdown (Sources, Tech, Area, Dispatcher, plus Job
 * Types, which Workiz does not have). The period is on the Jobs report's
 * dates, Workiz's "By Time":
 *
 * - `created`   — Created (`report_by=1`);
 * - `scheduled` — Scheduled, the visit's start (`report_by=2`);
 * - `end`       — **Closed** (`report_by=3`, the default). Checked live
 *   (2026-09-29): Workiz's "Closed" here is the visit's END (`job_end_date`),
 *   not the moment the job turned Done — the same jobs, day for day, as the
 *   Jobs report "By: Job end date".
 *
 * Days are the account's calendar (America/New_York), both ends included.
 *
 * The figures, as Workiz counts them:
 * - All = every job of the period, any status; Done / Canceled by status;
 *   Open = All − Done − Canceled; Canceled % = Canceled ÷ All (on the Area
 *   rows ÷ Done + Canceled — Workiz's own inconsistency, kept).
 * - Gross (Total Sales) = Σ the Done jobs' total.
 * - Profit = Σ the Done jobs' COMPANY profit after the technician's share —
 *   the "Company Profit" of Commissions (Legacy): Workiz's own frozen figure
 *   on an imported job, the Workiz commission formula on a job done here.
 * - Average Sale / Profit = Gross / Profit ÷ Done jobs.
 * - Tech expenses = Σ the Done jobs' tech parts; Labor cost = Σ their labour
 *   cost (timesheets — 0 in this account, as in Workiz).
 */
export type JobStatisticsBy = JobsReportBy;

/** Workiz's "By Time" labels. */
export const JOB_STATISTICS_BY_LABEL: Record<JobStatisticsBy, string> = {
  created: 'Created',
  scheduled: 'Scheduled',
  end: 'Closed',
};

/** The breakdown tables, in Workiz's tab order (Job Types is BitCRM's own). */
export const JOB_STATISTICS_TABS = ['sources', 'tech', 'area', 'dispatcher', 'jobTypes'] as const;
export type JobStatisticsTab = (typeof JOB_STATISTICS_TABS)[number];

/**
 * The `reports` action that opens each tab — Workiz's sub-permissions of
 * "Statistics Report" (Ad 1010, Tech 1011, Area 1012, Dispatch 1013). A role
 * that has never been given one keeps the tab (only an explicit `false`
 * closes it), so no existing role loses what it had. Job Types has none.
 */
export const JOB_STATISTICS_TAB_ACTION: Record<JobStatisticsTab, string | undefined> = {
  sources: 'view_ad_statistics',
  tech: 'view_tech_statistics',
  area: 'view_area_statistics',
  dispatcher: 'view_dispatch_statistics',
  jobTypes: undefined,
};

/** Workiz "View Profit" (1014): without it Profit and Average Profit are left out. */
export const JOB_STATISTICS_PROFIT_ACTION = 'view_profit';

/** The counts every table row, total and KPI carries. */
export interface JobStatisticsCounts {
  all: number;
  done: number;
  /** All − Done − Canceled. */
  open: number;
  canceled: number;
  /**
   * Canceled ÷ All × 100, two decimals — except on an Area row, where Workiz
   * divides by Done + Canceled (its Totals row is still over All).
   */
  canceledPct: number;
}

/**
 * The money of a row, over its Done jobs. Absent without `financials.view`;
 * `profit` and `avgProfit` are absent without the profit grant as well.
 * `laborCost` and `techExpenses` are on the Tech table (and the KPIs) only.
 */
export interface JobStatisticsMoney {
  gross?: number;
  profit?: number;
  laborCost?: number;
  techExpenses?: number;
  avgSale?: number;
  avgProfit?: number;
}

export type JobStatisticsTotals = JobStatisticsCounts & JobStatisticsMoney;

export interface JobStatisticsRow extends JobStatisticsTotals {
  /** Stable within the table: a source group, a tech combination, an area, a user… */
  key: string;
  /** The printed name; "" when the thing has none (no source, no zip…). */
  label: string;
  /** Sources: an ad group (job source) or a company the job came from (Workiz "referrals"). */
  kind?: 'ad' | 'external';
  /** Tech: the combination's technicians in assignment order; [] = unassigned. */
  techIds?: string[];
  /** Area by city or zip: the service area most of the row's jobs are in. */
  serviceArea?: string;
  /** Area by zip: the city most of the row's jobs are in. */
  city?: string;
}

export interface JobStatisticsTable {
  rows: JobStatisticsRow[];
  totals: JobStatisticsTotals;
}

export interface JobStatisticsDay {
  /** `YYYY-MM-DD`, account calendar. */
  date: string;
  /** Every job of the day, canceled ones included (Workiz's "Jobs" bar). */
  jobs: number;
  canceled: number;
  done: number;
  sales?: number;
  profit?: number;
}

export interface JobStatisticsKpis extends JobStatisticsTotals {
  /** Only the Submitted status — Pending is not a KPI (Workiz). */
  submitted: number;
  /** Only In Progress. */
  inProgress: number;
  pending: number;
  donePendingApproval: number;
}

/** `GET /deals/report/statistics`. */
export interface JobStatistics {
  window: { by: JobStatisticsBy; from: string; to: string };
  /** What this caller may see — the server leaves the rest out. */
  access: { money: boolean; profit: boolean; tabs: JobStatisticsTab[] };
  kpis: JobStatisticsKpis;
  /** One row per day of the window, zeros included. */
  series: JobStatisticsDay[];
  sources?: JobStatisticsTable;
  tech?: JobStatisticsTable;
  /**
   * By service area, city and zip. Like Workiz, a job without a service area
   * is in none of the three (`withoutArea` says how many there are).
   */
  area?: { metro: JobStatisticsTable; city: JobStatisticsTable; zip: JobStatisticsTable; withoutArea: number };
  /** By the user who created the job. */
  dispatcher?: JobStatisticsTable;
  jobTypes?: JobStatisticsTable;
  /**
   * Where the Done jobs' profit came from: Workiz's frozen Commissions figure
   * (imported jobs) or the Workiz formula (jobs done here). Absent without
   * the profit grant.
   */
  profitSources?: { workiz: number; computed: number };
  /** Something the figures could not include — e.g. rates or payments that could not be read. */
  warnings: string[];
}
