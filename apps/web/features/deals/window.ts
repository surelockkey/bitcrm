import { JobSuperStatus, SUPER_STATUS_ORDER } from "@bitcrm/types";
import type { DealsListParams } from "./query-params";

/** The statuses a job is still alive in — the set a board holds whole, whatever the date. */
export const OPEN_SUPER_STATUSES: JobSuperStatus[] = SUPER_STATUS_ORDER.filter(
  (s) => s !== JobSuperStatus.DONE && s !== JobSuperStatus.CANCELED,
);

/**
 * What a board or a schedule wants to hold: a span of visit days (at most
 * 31), or, with no days, the open jobs of every date. A closed job is only
 * ever read inside a window — Done and Canceled are hundreds of thousands
 * of rows after the import, and no screen shows them all.
 */
export interface DealsWindow {
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  /** Narrow to these statuses; without a window only the open ones among them are read. */
  statuses?: JobSuperStatus[];
  techId?: string;
}

/** The page size a bounded drain reads with — the server's maximum. */
const DRAIN_PAGE = 100;

/**
 * The list requests that together hold a window. With days: one merged
 * request over every status, or one per chosen status. Without days: one
 * per open status, each partition read whole (a few hundred rows in all).
 */
export function windowRequests(window: DealsWindow): DealsListParams[] {
  const base: DealsListParams = { sort: "schedule", dir: "asc", limit: DRAIN_PAGE };
  if (window.techId) base.techId = window.techId;

  if (window.from) {
    const days = { scheduledFrom: window.from, scheduledTo: window.to ?? window.from };
    if (!window.statuses?.length) return [{ ...days, ...base }];
    return window.statuses.map((superStatus) => ({ superStatus, ...days, ...base }));
  }

  const statuses = window.statuses?.length
    ? window.statuses.filter((s) => OPEN_SUPER_STATUSES.includes(s))
    : OPEN_SUPER_STATUSES;
  return statuses.map((superStatus) => ({ superStatus, ...base }));
}
