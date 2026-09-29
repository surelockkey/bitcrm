import type { JobSuperStatus } from '../enums/deal-stage.enum';

/** The date a stats window is on — the same "By:" as the Jobs report. */
export type DealStatsBy = 'created' | 'closed' | 'scheduled';

/** One group of a breakdown (a tech, a source, a zip…); `key` "" = none set. */
export interface DealStatsBucket {
  key: string;
  all: number;
  done: number;
  /** Neither done nor canceled. */
  open: number;
  canceled: number;
  /** Sales of the group's Done jobs; absent without `financials.view`. */
  revenue?: number;
  profit?: number;
}

export interface DealStatsDay {
  date: string;
  /** Jobs on the day that were not canceled. */
  jobs: number;
  canceled: number;
  revenue?: number;
  profit?: number;
}

/** Money over the window's Done jobs — what Workiz counts as sold. */
export interface DealStatsMoney {
  /** Σ what the client is billed (tax included). */
  revenue: number;
  tax: number;
  /** Σ company cost of the lines. */
  cost: number;
  /** revenue − tax − cost, as commissions count it. */
  profit: number;
  /** revenue ÷ Done jobs. */
  avgSale: number;
  /** profit ÷ Done jobs. */
  avgProfit: number;
  /** revenue ÷ days in the window. */
  avgPerDay: number;
  doneJobs: number;
}

/**
 * `GET /deals/stats` — a period at a glance (the dashboard, Job Statistics).
 * Counts cover every job in the window; the money is its Done jobs'.
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
  byCity: DealStatsBucket[];
  byZip: DealStatsBucket[];
}
