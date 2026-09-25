import type { JobSuperStatus } from '../enums/deal-stage.enum';

/** The date a stats window is on — the same "By:" as the Jobs report. */
export type DealStatsBy = 'created' | 'closed' | 'scheduled';

/** One group of a breakdown (a tech, a creator, a job type…); `key` "" = none set. */
export interface DealStatsBucket {
  key: string;
  jobs: number;
  /** Absent without `financials.view`. */
  revenue?: number;
}

export interface DealStatsDay {
  date: string;
  jobs: number;
  revenue?: number;
}

/** Money over the window's jobs that were not canceled. */
export interface DealStatsMoney {
  /** Σ what the client is billed (tax included). */
  revenue: number;
  tax: number;
  /** Σ company cost of the lines. */
  cost: number;
  /** revenue − tax − cost, as commissions count it. */
  profit: number;
  /** revenue ÷ jobs that brought money. */
  avgSale: number;
  /** revenue ÷ days in the window. */
  avgPerDay: number;
  pricedJobs: number;
}

/**
 * `GET /deals/stats` — a period at a glance (the dashboard, Job Statistics).
 * Counts cover every job in the window; the breakdowns and the money leave
 * canceled jobs out.
 */
export interface DealStats {
  window: { by: DealStatsBy; from: string; to: string };
  jobs: { total: number; byStatus: Record<JobSuperStatus, number> };
  money?: DealStatsMoney;
  series: DealStatsDay[];
  byTech: DealStatsBucket[];
  byCreator: DealStatsBucket[];
  byJobType: DealStatsBucket[];
  bySource: DealStatsBucket[];
  byServiceArea: DealStatsBucket[];
}
