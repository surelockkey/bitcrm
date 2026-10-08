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
 * for what it will get. Each flag names the parameters the backend takes
 * (main 974cf6d8, `backend/jobs-list-search`).
 */
export interface JobsListCaps {
  /**
   * Several values per filter, any-of: `techIds`, `jobTypeIds`,
   * `serviceAreas`, `businessProfileIds` (comma lists, ≤ 50 each) and
   * `tagIds` with `tagMatch=any`. Off, each group keeps one value — a second
   * pick replaces the first — because a bare `tagIds=a,b` means all-of.
   */
  multiValue: boolean;
  /** `unpaid=true`: only jobs with money still owed. */
  unpaid: boolean;
  /**
   * `q=<text>`: the list's own search inside the tab and every filter —
   * client name ("Just here" too), Job ID ("5TU7", "#5TU7"), phone digits
   * (for a caller with `contacts.view_numbers`), street / city / state /
   * zip, job name, emails, client company, job type. Off, only a sure job
   * code is looked up (`search`).
   */
  textSearch: boolean;
}

/** main 974cf6d8: any-of lists, `unpaid=true` and `q`, on the list and the counts. */
export const JOBS_LIST_CAPS: JobsListCaps = { multiValue: true, unpaid: true, textSearch: true };

/** The server takes `q` up to this long (`@MaxLength(200)`). */
export const JOBS_SEARCH_MAX = 200;

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
  tagMatch?: "any" | "all";
  /** `JobsListCaps.unpaid`. */
  unpaid?: boolean;
  /** A job code, looked up exactly. */
  search?: string;
  /** The Search box's text — `JobsListCaps.textSearch`. */
  q?: string;
  sort?: "schedule" | "created";
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

/**
 * The `GET /deals/counts` query: the list's filters, minus the tab, the sort
 * and the paging. `q` only on the one count a search adds
 * (`toSearchCountsParams`).
 */
export type DealCountsParams = Omit<
  DealsListParams,
  "superStatus" | "unscheduled" | "sort" | "dir" | "limit" | "cursor" | "search"
>;

/** Six characters of letters and digits, the way a Job ID is typed. */
export const JOB_CODE = /^[A-Z0-9]{6}$/i;

/**
 * On a backend without `q`, the Search box can still find a job by its
 * code — but only one surely shaped like one: six characters mixing letters
 * and digits. Six letters alone ("Dustin") is as likely a name and six
 * digits a phone fragment.
 */
const SURE_JOB_CODE = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{6}$/i;

/**
 * Where the Search box's text is answered: by the list's own `q` — as Workiz
 * sends whatever is in its box — or, on a backend without it, by the exact
 * code lookup when the text is surely a code.
 */
export function jobsSearchRoute(text: string, caps: JobsListCaps = JOBS_LIST_CAPS): "none" | "code" | "list" {
  const q = text.trim();
  if (!q) return "none";
  if (caps.textSearch) return "list";
  return SURE_JOB_CODE.test(q) ? "code" : "none";
}

/** The Search box's text as `q`: trimmed, and no longer than the server takes. */
const searchText = (state: JobsListState) => state.search.trim().slice(0, JOBS_SEARCH_MAX);

/** One group's values: the any-of list, or the first value on an older backend. */
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
  const q = searchText(state);
  const route = jobsSearchRoute(q, caps);
  if (route === "list") out.q = q;
  else if (route === "code") out.search = q.toUpperCase();
  return out;
}

/**
 * The numbers on the tabs, as Workiz shows them: every tab counted under the
 * filters but not the search…
 */
export function toCountsParams(state: JobsListState, caps: JobsListCaps = JOBS_LIST_CAPS): DealCountsParams {
  return sharedFilters(state, caps);
}

/**
 * …and, while something is typed, the same filters once more with `q` — the
 * open tab's chip shows that number (Workiz: "Submitted 210" → "1"), the
 * others keep theirs. `null` when there is nothing to count.
 */
export function toSearchCountsParams(
  state: JobsListState,
  caps: JobsListCaps = JOBS_LIST_CAPS,
): DealCountsParams | null {
  const q = searchText(state);
  if (jobsSearchRoute(q, caps) !== "list") return null;
  return { ...sharedFilters(state, caps), q };
}
