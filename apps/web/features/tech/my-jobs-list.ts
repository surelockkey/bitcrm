import type { FilterCatalogs } from "@/features/deals/job-filters";
import type { JobsListState } from "@/features/deals/query-params";

/**
 * `/my-jobs` is Workiz's jobs list as a technician sees it: the same tabs,
 * Filter results, strip and grid, holding only the jobs they are on.
 *
 * The tech filter is what makes it "mine", so it is the viewer, always —
 * whatever the controls hold. The server would narrow a technician to their
 * own jobs anyway (the assigned_only scope), but a dispatcher who opens this
 * page has no such scope: the id has to be sent.
 */
export function myJobsListState(state: JobsListState, meId: string): JobsListState {
  return { ...state, techIds: [meId] };
}

/** Filter results on `/my-jobs`: no TECHS column — the list is always yours. */
export function myJobsCatalogs(catalogs: FilterCatalogs): FilterCatalogs {
  return { ...catalogs, techs: [] };
}

/** Where a row opens: the technician's own job page. */
export const myJobHref = (dealId: string): string => `/my-jobs/${dealId}`;
