import { type TimeClockLocation, type TimeClockSource } from '../entities/time-clock-entry.entity';
import { type JobsReportPagination } from './jobs-report';

/**
 * The Workiz Timesheets report (`/root/timesheet`), shared by user-service
 * (`GET /users/timeclock/report`, `GET /users/timeclock/report/entries`) and
 * the web page `/reports/timesheets`.
 *
 * One row per person who has a time-clock entry that STARTED in the period
 * (the account's calendar, America/New_York, both ends included), with the
 * total row on top. A row opens into that person's entries.
 *
 * The arithmetic is Workiz's, checked live against its report on 2026-09-30:
 *
 * - **Hours** — the time the person was on the clock: their closed entries
 *   laid on one line, overlaps counted once. An entry is counted whole, even
 *   when it runs past the period's last day; a running entry counts nothing.
 * - **Gross Hours** (Workiz: CSV only) — Σ of the entries' own minutes, so
 *   overlapping entries count twice. Equal to Hours when nothing overlaps.
 * - **Cost** — each entry's minutes × its own labor cost per hour; a stretch
 *   two entries share is paid once, at the rate of the entry that started
 *   first. **Gross Cost** — Σ of every entry's own cost.
 * - **Jobs** — distinct jobs among the person's entries; the total row counts
 *   distinct jobs over everyone (two people on one job is one job).
 *
 * Minutes are real elapsed time between the two instants, so a shift that
 * spans a clock change is an hour shorter or longer than its wall clock says
 * — as in Workiz's own Hours column.
 */

/** Columns the report sorts on — Workiz's `name`, `total_time`, `total_cost`, `jobs_count`. */
export const TIMESHEET_REPORT_SORTS = ['name', 'hours', 'cost', 'jobs'] as const;
export type TimesheetReportSort = (typeof TIMESHEET_REPORT_SORTS)[number];

/** The filter's "Jobs" group: entries clocked to a job, or not. Both ticked = no filter. */
export const TIMESHEET_JOB_FILTERS = ['with_job', 'without_job'] as const;
export type TimesheetJobFilter = (typeof TIMESHEET_JOB_FILTERS)[number];

export const TIMESHEET_JOB_FILTER_LABEL: Record<TimesheetJobFilter, string> = {
  with_job: 'With Job',
  without_job: 'Without Job',
};

/** The longest period one request may cover — a year, like the other reports. */
export const TIMESHEET_REPORT_MAX_DAYS = 366;
/** Rows per page the server accepts (the export asks for everything in one page). */
export const TIMESHEET_REPORT_MAX_PAGE_SIZE = 1000;
/** Workiz's page-size choices on this report, and the one it opens on. */
export const TIMESHEET_REPORT_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;
export const TIMESHEET_REPORT_DEFAULT_PAGE_SIZE = 10;

/** "Filter results": OR inside a group, AND between them. */
export interface TimesheetReportFilters {
  /** Team — these people only. */
  userId?: string[];
  job?: TimesheetJobFilter[];
}

/** One person's line. */
export interface TimesheetReportRow {
  userId: string;
  /** The person's name as BitCRM knows it; the id when the person is gone. */
  name: string;
  /** Clocked in right now, whatever the period — Workiz's "Clocked In" / "Clocked Out" tag. */
  clockedIn: boolean;
  /** Hours — minutes on the clock, overlaps counted once. */
  minutes: number;
  /** Gross Hours — Σ of the entries' own minutes. */
  grossMinutes: number;
  /** Cost in dollars; absent without `financials.view`. */
  cost?: number;
  grossCost?: number;
  /** Distinct jobs among the entries. */
  jobs: number;
  /** Entries in the period, running ones included. */
  entries: number;
}

/** The total row: Σ of the rows shown by the filter and search, jobs counted once over everyone. */
export interface TimesheetReportTotal {
  minutes: number;
  grossMinutes: number;
  cost?: number;
  grossCost?: number;
  jobs: number;
  entries: number;
}

export type TimesheetReportPagination = JobsReportPagination;

export interface TimesheetReportPage {
  rows: TimesheetReportRow[];
  total: TimesheetReportTotal;
  pagination: TimesheetReportPagination;
  /** Days on the account's calendar, both included. */
  window: { from: string; to: string };
  sort: { column: TimesheetReportSort; dir: 'asc' | 'desc' };
  /** False when money is withheld from this caller (no `financials.view`). */
  money: boolean;
}

/** One entry of a person, as the opened row lists it. */
export interface TimesheetEntryRow {
  id: string;
  userId: string;
  /** ISO instant. */
  startedAt: string;
  /** ISO instant; absent while the clock runs. */
  endedAt?: string;
  /** Still running — Workiz's "Clocked in (locked)". */
  open: boolean;
  /** The entry's own minutes; 0 while it runs. */
  minutes: number;
  /** `minutes / 60 × laborCostPerHour`; absent without `financials.view`. */
  cost?: number;
  laborCostPerHour?: number;
  dealId?: string;
  startLocation?: TimeClockLocation;
  endLocation?: TimeClockLocation;
  notes?: string;
  source: TimeClockSource;
}

/** A person's entries in the period — every one, newest first; the page sorts and pages them. */
export interface TimesheetEntriesPage {
  userId: string;
  name: string;
  clockedIn: boolean;
  rows: TimesheetEntryRow[];
  /** The person's line of the report: Workiz prints it under the entries as "Total" and "Gross Total". */
  total: Omit<TimesheetReportTotal, 'jobs' | 'entries'>;
  window: { from: string; to: string };
  money: boolean;
}
