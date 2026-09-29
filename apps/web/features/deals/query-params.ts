import type { JobSuperStatus } from "@bitcrm/types";
import type { JobTab } from "./lib";

/** Workiz pages its jobs list fifty at a time. */
export const JOBS_PAGE_SIZE = 50;

/** The toolbar sort choices; the hour ones are settled on the page, within what was loaded. */
export type JobsSort = "none" | "day_asc" | "day_desc" | "hour_asc" | "hour_desc";

/** Everything the jobs page toolbar holds — what the server is asked for is derived from this. */
export interface JobsListState {
  tab: JobTab;
  search: string;
  techId?: string;
  jobTypeId?: string;
  serviceArea?: string;
  tagId?: string;
  businessProfileId?: string;
  /** YYYY-MM-DD, inclusive. */
  dateFrom?: string;
  dateTo?: string;
  /** HH:MM, inclusive. */
  hourFrom?: string;
  hourTo?: string;
  sort: JobsSort;
}

/** The `GET /deals` query the jobs page sends — one status or the undated ones, in visit order. */
export interface DealsListParams {
  superStatus?: JobSuperStatus;
  unscheduled?: boolean;
  scheduledFrom?: string;
  scheduledTo?: string;
  /** The report's other two dates — one window at a time. */
  createdFrom?: string;
  createdTo?: string;
  closedFrom?: string;
  closedTo?: string;
  sourceId?: string;
  companyId?: string;
  createdBy?: string;
  hourFrom?: string;
  hourTo?: string;
  techId?: string;
  jobTypeId?: string;
  serviceArea?: string;
  tagIds?: string;
  businessProfileId?: string;
  subStatusId?: string;
  contactId?: string;
  /** A job code — the only text the server searches by itself. */
  search?: string;
  sort?: "schedule" | "created";
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

/** The `GET /deals/counts` query: the list's filters, minus the tab, the sort and the paging. */
export type DealCountsParams = Omit<DealsListParams, "superStatus" | "unscheduled" | "sort" | "dir" | "limit" | "cursor" | "search">;

/** Six characters of letters and digits, the way a Job ID is typed. */
export const JOB_CODE = /^[A-Z0-9]{6}$/i;

/** The filters shared by the list and its tab counts. */
function sharedFilters(state: JobsListState): DealCountsParams {
  const out: DealCountsParams = {};
  if (state.techId) out.techId = state.techId;
  if (state.jobTypeId) out.jobTypeId = state.jobTypeId;
  if (state.serviceArea) out.serviceArea = state.serviceArea;
  if (state.tagId) out.tagIds = state.tagId;
  if (state.businessProfileId) out.businessProfileId = state.businessProfileId;
  if (state.dateFrom) {
    out.scheduledFrom = state.dateFrom;
    out.scheduledTo = state.dateTo || state.dateFrom;
  }
  if (state.hourFrom) out.hourFrom = state.hourFrom;
  if (state.hourTo) out.hourTo = state.hourTo;
  return out;
}

export function toListParams(state: JobsListState, size = JOBS_PAGE_SIZE): DealsListParams {
  const out: DealsListParams = {
    ...sharedFilters(state),
    sort: "schedule",
    dir: state.sort === "day_desc" ? "desc" : "asc",
    limit: size,
  };
  if (state.tab === "unscheduled") out.unscheduled = true;
  else out.superStatus = state.tab;
  const q = state.search.trim();
  if (JOB_CODE.test(q)) out.search = q.toUpperCase();
  return out;
}

export function toCountsParams(state: JobsListState): DealCountsParams {
  return sharedFilters(state);
}
