import { JobSuperStatus } from "@bitcrm/types";
import type { JobTab } from "./lib";

/** Workiz pages its jobs list fifty at a time. */
export const JOBS_PAGE_SIZE = 50;

/** The sort choices; the hour ones are settled on the page, within what was loaded. */
export type JobsSort = "none" | "day_asc" | "day_desc" | "hour_asc" | "hour_desc";

/**
 * Everything the jobs page's controls hold — the tab, the Search box, the
 * chips in "Filter results" and "Show unpaid jobs". What the server is asked
 * for is derived from this.
 *
 * Every filter is a list because Workiz's control takes several values per
 * group (OR inside a group, AND across groups); whether the server can take
 * more than one is `JobsListCaps.multiValue`.
 */
export interface JobsListState {
  /** One of Workiz's five tabs, or a closed status picked under STATUS in Filter results. */
  tab: JobTab;
  search: string;
  techIds: string[];
  jobTypeIds: string[];
  /** Service-area names — the list filters on the name the job carries. */
  serviceAreas: string[];
  tagIds: string[];
  businessProfileIds: string[];
  /** YYYY-MM-DD, inclusive. */
  dateFrom?: string;
  dateTo?: string;
  /** HH:MM, inclusive. */
  hourFrom?: string;
  hourTo?: string;
  sort: JobsSort;
  /** Workiz "Show unpaid jobs". */
  unpaid: boolean;
}

export const EMPTY_JOBS_LIST_STATE: JobsListState = {
  tab: JobSuperStatus.SUBMITTED,
  search: "",
  techIds: [],
  jobTypeIds: [],
  serviceAreas: [],
  tagIds: [],
  businessProfileIds: [],
  sort: "none",
  unpaid: false,
};

/**
 * What `GET /deals` (and `/deals/counts`) can answer, so the page asks only
 * for what it will get. Each flag names the parameters the backend has to
 * accept before it may be turned on — see the jobslist parity notes.
 */
export interface JobsListCaps {
  /**
   * Several values per filter, any-of: `techIds`, `jobTypeIds`,
   * `serviceAreas`, `businessProfileIds` (comma lists) and `tagIds` with
   * `tagMatch=any`. Until then each group keeps one value — a second pick
   * replaces the first — because `tagIds=a,b` means all-of today.
   */
  multiValue: boolean;
  /** `unpaid=true`: only jobs with an amount due above zero. */
  unpaid: boolean;
  /**
   * `q=<text>`: the list's own free-text search inside the tab and filters —
   * client name, phone digits, job ID prefix, city, job type. Until then the
   * search service answers the text (`jobsSearchRoute`).
   */
  textSearch: boolean;
}

/** main 03eb84e2: deal-service takes `unpaid=true` on the list and the counts. */
export const JOBS_LIST_CAPS: JobsListCaps = { multiValue: false, unpaid: true, textSearch: false };

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
  /** Any-of lists — `JobsListCaps.multiValue`. */
  techIds?: string;
  jobTypeIds?: string;
  serviceAreas?: string;
  businessProfileIds?: string;
  tagMatch?: "any";
  /** `JobsListCaps.unpaid`. */
  unpaid?: boolean;
  /** A job code — the only text the server searches by itself today. */
  search?: string;
  /** Free text — `JobsListCaps.textSearch`. */
  q?: string;
  sort?: "schedule" | "created";
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

/** The `GET /deals/counts` query: the list's filters, minus the tab, the sort, the search and the paging. */
export type DealCountsParams = Omit<
  DealsListParams,
  "superStatus" | "unscheduled" | "sort" | "dir" | "limit" | "cursor" | "search" | "q"
>;

/** Six characters of letters and digits, the way a Job ID is typed. */
export const JOB_CODE = /^[A-Z0-9]{6}$/i;

/**
 * The jobs page's Search box takes names and phones as well, so it is
 * stricter: six characters mixing letters and digits. Six letters alone
 * ("Dustin") is as likely a name and six digits a phone fragment — those go
 * to the text search, which finds a code as well.
 */
const SURE_JOB_CODE = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{6}$/i;

/**
 * Where the Search box's text is answered: a job code by the list's own
 * lookup, other text by the list's `q` once it has one, and by the search
 * service until then.
 */
export function jobsSearchRoute(text: string, caps: JobsListCaps = JOBS_LIST_CAPS): "none" | "code" | "list" | "service" {
  const q = text.trim();
  if (!q) return "none";
  if (SURE_JOB_CODE.test(q)) return "code";
  return caps.textSearch ? "list" : "service";
}

/** One group's values: the single-value parameter today, the any-of list later. */
function group(
  out: DealCountsParams,
  values: string[],
  caps: JobsListCaps,
  single: "techId" | "jobTypeId" | "serviceArea" | "businessProfileId",
  plural: "techIds" | "jobTypeIds" | "serviceAreas" | "businessProfileIds",
) {
  if (!values.length) return;
  if (caps.multiValue) out[plural] = values.join(",");
  else out[single] = values[0];
}

/** The filters shared by the list and its tab counts. */
function sharedFilters(state: JobsListState, caps: JobsListCaps): DealCountsParams {
  const out: DealCountsParams = {};
  group(out, state.techIds, caps, "techId", "techIds");
  group(out, state.jobTypeIds, caps, "jobTypeId", "jobTypeIds");
  group(out, state.serviceAreas, caps, "serviceArea", "serviceAreas");
  if (state.tagIds.length) {
    if (caps.multiValue) {
      out.tagIds = state.tagIds.join(",");
      out.tagMatch = "any";
    } else {
      out.tagIds = state.tagIds[0];
    }
  }
  group(out, state.businessProfileIds, caps, "businessProfileId", "businessProfileIds");
  if (state.dateFrom) {
    out.scheduledFrom = state.dateFrom;
    out.scheduledTo = state.dateTo || state.dateFrom;
  }
  if (state.hourFrom) out.hourFrom = state.hourFrom;
  if (state.hourTo) out.hourTo = state.hourTo;
  if (caps.unpaid && state.unpaid) out.unpaid = true;
  return out;
}

export function toListParams(
  state: JobsListState,
  size = JOBS_PAGE_SIZE,
  caps: JobsListCaps = JOBS_LIST_CAPS,
): DealsListParams {
  const out: DealsListParams = {
    ...sharedFilters(state, caps),
    sort: "schedule",
    dir: state.sort === "day_desc" ? "desc" : "asc",
    limit: size,
  };
  if (state.tab === "unscheduled") out.unscheduled = true;
  else out.superStatus = state.tab;
  const q = state.search.trim();
  const route = jobsSearchRoute(q, caps);
  if (route === "code") out.search = q.toUpperCase();
  else if (route === "list") out.q = q;
  return out;
}

export function toCountsParams(state: JobsListState, caps: JobsListCaps = JOBS_LIST_CAPS): DealCountsParams {
  return sharedFilters(state, caps);
}
