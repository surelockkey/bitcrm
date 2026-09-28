import type { JobSuperStatus } from '../enums/deal-stage.enum';

/**
 * One slice of a dashboard pie — "Top Sources", "Top Job Types", "Service
 * Areas". `percent` is the slice's share of the slices shown, not of every
 * job: Workiz draws the top four and their percentages add up to 100.
 */
export interface DashboardShare {
  /** The catalog id (or the area's own name); never empty. */
  key: string;
  /** What the legend says. */
  name: string;
  /** Jobs created in the window under this key. */
  count: number;
  /** 0–100, two decimals. */
  percent: number;
}

export interface DashboardShares {
  slices: DashboardShare[];
}

/** One day of "Sales": what the day's Done jobs were billed, and what was left of it. */
export interface DashboardSalesDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Σ billed, tax included. */
  total: number;
  /** total − tax − company cost, as Job Statistics counts profit. */
  net: number;
}

export interface DashboardSales {
  /** Every day of the window, zeros included. */
  days: DashboardSalesDay[];
  total: number;
  net: number;
}

/** A row of a scoreboard — a technician or a dispatcher (the job's creator). */
export interface DashboardScoreRow {
  /** User id. */
  id: string;
  /** Their name, or empty when user-service could not say. */
  name: string;
  /** Done jobs closed in the window. */
  jobs: number;
  /** What those jobs sold; absent without `financials.view`. */
  sales?: number;
}

export interface DashboardScoreboard {
  rows: DashboardScoreRow[];
}

/** "Jobs": how many jobs stand in each unclosed state right now. */
export interface DashboardJobsNow {
  byStatus: Record<Exclude<JobSuperStatus, JobSuperStatus.DONE | JobSuperStatus.CANCELED>, number>;
}

/** "Today": the day so far. */
export interface DashboardToday {
  /** Σ billed on jobs finished today; absent without `financials.view`. */
  sales?: number;
  jobsDone: number;
  jobsCanceled: number;
  jobsCreated: number;
}

/** "Top Call Flows": inbound calls per flow per day. */
export interface CallFlowSeries {
  /** Every day of the window, in order. */
  days: string[];
  /** Busiest flow first; `counts[i]` belongs to `days[i]`. */
  flows: { name: string; counts: number[] }[];
  /** The walk stopped on its read budget: the counts are floors. */
  atLeast: boolean;
}
