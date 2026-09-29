import type { JobSuperStatus } from "@bitcrm/types";
import { JOB_CODE, type DealsListParams } from "@/features/deals/query-params";
import type { JobsReportDateField } from "./lib";

/** The toolbar sorts; the hour ones are settled on the page, within the loaded rows. */
export type ReportSort = "none" | "day_asc" | "day_desc" | "hour_asc" | "hour_desc";

/** Everything the report toolbar holds — the server request is derived from it. */
export interface JobsReportState {
  dateField: JobsReportDateField;
  /** YYYY-MM-DD, inclusive; the window is never open-ended. */
  from: string;
  to: string;
  search: string;
  sort: ReportSort;
  size: number;
  superStatus?: JobSuperStatus;
  subStatusId?: string;
  techId?: string;
  createdBy?: string;
  tagId?: string;
  jobTypeId?: string;
  sourceId?: string;
  serviceArea?: string;
  companyId?: string;
  hourFrom?: string;
  hourTo?: string;
}

/** What the report sends to `GET /deals` and `GET /deals/counts`. */
export type ReportParams = DealsListParams;

/** The window on the date the report is "By:", plus every filter — what the list and its total share. */
export function reportCountsParams(state: JobsReportState): ReportParams {
  const out: ReportParams = {};
  if (state.dateField === "createdAt") {
    out.createdFrom = state.from;
    out.createdTo = state.to;
  } else if (state.dateField === "scheduledDate") {
    out.scheduledFrom = state.from;
    out.scheduledTo = state.to;
  } else {
    out.closedFrom = state.from;
    out.closedTo = state.to;
  }
  if (state.superStatus) out.superStatus = state.superStatus;
  if (state.subStatusId) out.subStatusId = state.subStatusId;
  if (state.techId) out.techId = state.techId;
  if (state.createdBy) out.createdBy = state.createdBy;
  if (state.tagId) out.tagIds = state.tagId;
  if (state.jobTypeId) out.jobTypeId = state.jobTypeId;
  if (state.sourceId) out.sourceId = state.sourceId;
  if (state.serviceArea) out.serviceArea = state.serviceArea;
  if (state.companyId) out.companyId = state.companyId;
  if (state.hourFrom) out.hourFrom = state.hourFrom;
  if (state.hourTo) out.hourTo = state.hourTo;
  return out;
}

export function reportListParams(state: JobsReportState): ReportParams {
  const out: ReportParams = {
    ...reportCountsParams(state),
    // The server orders by the date the window is on; newest first unless asked otherwise.
    dir: state.sort === "day_asc" ? "asc" : "desc",
    limit: state.size,
  };
  if (state.dateField === "scheduledDate") out.sort = "schedule";
  const q = state.search.trim();
  if (JOB_CODE.test(q)) out.search = q.toUpperCase();
  return out;
}
