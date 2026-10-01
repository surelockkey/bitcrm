import { type JobSuperStatus } from '../enums/deal-stage.enum';
import { type JobTagColor } from '../enums/job-tag-color.enum';

/**
 * The Workiz Jobs report (`/root/jobreport`), shared by deal-service
 * (`GET /deals/report`, `GET /deals/report/export`) and the web page.
 *
 * Every job of a period, any status, with a multi-filter, a column chooser,
 * server-side sort and paging, and a CSV of the visible columns. The period
 * is on one of three dates — Workiz's "By:" dropdown:
 *
 * - `created`   — when the job was created (Workiz `report_by=1`);
 * - `scheduled` — the visit's start, "Job date" (`report_by=2`);
 * - `end`       — the visit's end, "Job end date" (`report_by=3`). This is
 *   NOT the moment the job was closed: Workiz moves a job's dates to the
 *   actual visit when it is closed, and reports on the visit's end.
 *
 * Days are the account's calendar (America/New_York), both ends included.
 */
export const JOBS_REPORT_BY = ['created', 'scheduled', 'end'] as const;
export type JobsReportBy = (typeof JOBS_REPORT_BY)[number];

/** Workiz's labels for the "By:" dropdown. */
export const JOBS_REPORT_BY_LABEL: Record<JobsReportBy, string> = {
  created: 'Job created',
  scheduled: 'Job date',
  end: 'Job end date',
};

/**
 * The report's columns in Workiz's fixed order (`jobReportSettings`), with
 * Workiz's `db_name` beside ours. `visible` is what a fresh account shows —
 * the sixteen columns the SLK account had switched on when it was checked
 * live (2026-09-29). Every column sorts on the server.
 */
export const JOBS_REPORT_COLUMNS = [
  { id: 'jobNumber', label: 'Job #', workiz: 'serial', visible: true },
  { id: 'jobName', label: 'Job name', workiz: 'job_name', visible: false },
  { id: 'client', label: 'Client', workiz: 'client', visible: true },
  { id: 'tags', label: 'Tags', workiz: 'tags', visible: true },
  { id: 'type', label: 'Type', workiz: 'type_name', visible: true },
  { id: 'created', label: 'Job Created', workiz: 'created', visible: true },
  { id: 'scheduled', label: 'Scheduled', workiz: 'job_date', visible: true },
  { id: 'end', label: 'End', workiz: 'job_end_date', visible: true },
  { id: 'phone', label: 'Phone', workiz: 'primary_phone', visible: true },
  { id: 'email', label: 'Email', workiz: 'email_address', visible: false },
  { id: 'status', label: 'Status', workiz: 'status', visible: true },
  { id: 'tech', label: 'Tech', workiz: 'tech', visible: true },
  { id: 'createdBy', label: 'Created by', workiz: 'userCreated', visible: false },
  { id: 'address', label: 'Address', workiz: 'address', visible: false },
  { id: 'city', label: 'City', workiz: 'city', visible: true },
  { id: 'state', label: 'State', workiz: 'state', visible: true },
  { id: 'zip', label: 'Zip code', workiz: 'zipcode', visible: true },
  { id: 'serviceArea', label: 'Metro Area', workiz: 'metro_name', visible: true },
  { id: 'total', label: 'Total', workiz: 'job_total_price', visible: true },
  { id: 'source', label: 'Source', workiz: 'group_name', visible: true },
  { id: 'externalCompany', label: 'External Company', workiz: 'company_name', visible: false },
  { id: 'leadCreated', label: 'Lead Created Date', workiz: 'lead_creation_date', visible: false },
  { id: 'origin', label: 'Job origin', workiz: 'converted', visible: false },
] as const;

export type JobsReportColumnId = (typeof JOBS_REPORT_COLUMNS)[number]['id'];

export const JOBS_REPORT_COLUMN_IDS: readonly JobsReportColumnId[] = JOBS_REPORT_COLUMNS.map((c) => c.id);

export const JOBS_REPORT_DEFAULT_COLUMNS: readonly JobsReportColumnId[] = JOBS_REPORT_COLUMNS.filter((c) => c.visible).map(
  (c) => c.id,
);

/** Workiz: a job converted from a lead is "Lead", every other one "New". */
export type JobsReportOrigin = 'lead' | 'new';

/** Rows per page the server accepts (Workiz's own endpoint takes 1000). */
export const JOBS_REPORT_MAX_PAGE_SIZE = 1000;
/** The longest period one request may cover — Workiz refuses more than twelve months. */
export const JOBS_REPORT_MAX_DAYS = 366;

/**
 * The multi-filter ("Filter results"): OR inside a group, AND between groups.
 * A status value is a super-status (`done`) or a super-status with one of its
 * sub-statuses (`done:<subStatusId>`), as Workiz lists "Status" and
 * "Status - Sub-status" side by side.
 */
export interface JobsReportFilters {
  status?: string[];
  /** Team — any of these technicians is assigned. */
  techId?: string[];
  createdBy?: string[];
  /** Any of these tags. */
  tagId?: string[];
  jobTypeId?: string[];
  origin?: JobsReportOrigin[];
  sourceId?: string[];
  serviceAreaId?: string[];
  /** Workiz "Companies" — the external (referring) company. */
  externalCompanyId?: string[];
}

/** One job as the report shows it — names resolved, dates in account time. */
export interface JobsReportRow {
  id: string;
  jobNumber: string;
  jobName?: string;
  contactId: string;
  client: string;
  clientCompany?: string;
  tags: { id: string; name: string; color?: JobTagColor }[];
  jobTypeId?: string;
  type: string;
  /** ISO instant. */
  createdAt: string;
  /** Account wall clock: `YYYY-MM-DDTHH:MM`, or `YYYY-MM-DD` for an all-day visit. */
  scheduled?: string;
  end?: string;
  /**
   * The job's number, when the caller may see numbers (`contacts.view_numbers`)
   * and the job carries one. `phoneMasked` says a number was withheld.
   */
  phone?: string;
  phoneMasked?: boolean;
  email?: string;
  superStatus: JobSuperStatus;
  status: string;
  subStatusId?: string;
  subStatus?: string;
  techIds: string[];
  tech: string[];
  createdById?: string;
  createdBy: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  serviceAreaId?: string;
  serviceArea?: string;
  /** Absent without `financials.view`. */
  total?: number;
  amountDue?: number;
  sourceId?: string;
  source?: string;
  externalCompanyId?: string;
  externalCompany?: string;
  leadCreated?: string;
  origin: JobsReportOrigin;
}

export interface JobsReportPagination {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  /** "Showing `from` to `to` of `total` results" — 1-based, 0 when empty. */
  from: number;
  to: number;
}

export interface JobsReportPage {
  rows: JobsReportRow[];
  pagination: JobsReportPagination;
  window: { by: JobsReportBy; from: string; to: string };
  sort: { column: JobsReportColumnId; dir: 'asc' | 'desc' };
  /** False when money is withheld from this caller (no `financials.view`). */
  money: boolean;
}

/**
 * Account-wide report settings — Workiz keeps the visible fields per account
 * (`jobReportSettings`). `by` is the "By:" a fresh page opens on.
 */
export interface JobsReportSettings {
  columns: JobsReportColumnId[];
  by: JobsReportBy;
}

export const JOBS_REPORT_DEFAULT_SETTINGS: JobsReportSettings = {
  columns: [...JOBS_REPORT_DEFAULT_COLUMNS],
  // What the SLK account's admin had set when checked live.
  by: 'end',
};
