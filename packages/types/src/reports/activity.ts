/**
 * Workiz Reports → Activity (`GET /api/deals/activity`): the account's journal
 * of who did what and when — job edits, statuses, reschedules, payments, tags,
 * sends, client views, logins — newest first, with the device it was done on.
 *
 * Rows come from the job timelines (`DEAL#<id>/TIMELINE#…`) and, for events
 * with no job, the `ACT#…` rows the Workiz import wrote; two sparse indexes on
 * those rows (by account day, by actor) make the period readable without a scan.
 */

/** Where an action was taken — Workiz's laptop / phone icon. */
export type ActivitySource = 'web' | 'mobile' | 'system';

export interface ActivityRow {
  id: string;
  /** ISO UTC; shown on the account's clock. */
  timestamp: string;
  actorId: string;
  /** The name as recorded with the event (Workiz's name for an imported one). */
  actorName: string;
  /** Came over from Workiz — its user name is Workiz's, as it read then. */
  imported: boolean;
  /** The Action column. */
  text: string;
  source?: ActivitySource;
  /** Workiz "ShineAI" mark. */
  doneByAI?: boolean;
  /** The job the event is about, when it exists here — the Job Id link. */
  dealId?: string;
  /** What the Job Id column prints: the job's code (Workiz uuid / our deal number). */
  jobRef?: string;
}

export type ActivitySort = 'desc' | 'asc';

/** Workiz's page sizes; 10 is its default. */
export const ACTIVITY_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;
export const ACTIVITY_DEFAULT_PAGE_SIZE = 10;
/** How many users one request may filter by (one index query each). */
export const ACTIVITY_MAX_USERS = 20;
/** The export's ceiling — the same one Workiz's server cuts its answers at. */
export const ACTIVITY_EXPORT_MAX_ROWS = 10_000;
/** The earliest day "All time" reaches back to (the account's first activity is 2017). */
export const ACTIVITY_FIRST_DAY = '2015-01-01';

export interface ActivityExport {
  rows: ActivityRow[];
  /** More rows matched than the export carries. */
  truncated: boolean;
}
