import type { Deal } from "@bitcrm/types";
import type { FilterCatalogs } from "@/features/deals/job-filters";
import type { JobsListState, JobsSort } from "@/features/deals/query-params";

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

/* ------------------------------------------------- the dispatcher's route */

const slotStart = (d: Deal): string => d.scheduledTimeSlot?.split("-")[0]?.trim() || "~";

/**
 * Visit order inside a day (ours — Workiz has no route order): the
 * technician's own stop when the dispatcher set one (`sequences[techId]`,
 * re-sequenced on the Dispatch board), then the slot start, then the job
 * number so the order is stable.
 */
export function compareVisitOrder(a: Deal, b: Deal, techId?: string): number {
  const sa = techId ? a.sequences?.[techId] : undefined;
  const sb = techId ? b.sequences?.[techId] : undefined;
  if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
  if (sa !== undefined && sb === undefined) return -1;
  if (sa === undefined && sb !== undefined) return 1;
  const ta = slotStart(a);
  const tb = slotStart(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a.dealNumber).localeCompare(String(b.dealNumber));
}

/**
 * The rows as the server ordered them by Scheduled, each day's run of rows
 * put in the viewer's route order — reversed with the days when the list is
 * latest first. Unscheduled rows stay as they came.
 */
export function inRouteOrder(deals: readonly Deal[], techId: string, sort: JobsSort): Deal[] {
  const sign = sort === "day_desc" ? -1 : 1;
  const out: Deal[] = [];
  let run: Deal[] = [];
  const flush = () => {
    const day = run[0]?.scheduledDate;
    out.push(...(day ? [...run].sort((a, b) => sign * compareVisitOrder(a, b, techId)) : run));
    run = [];
  };
  for (const d of deals) {
    if (run.length && run[0].scheduledDate !== d.scheduledDate) flush();
    run.push(d);
  }
  flush();
  return out;
}

/** The viewer's stop number on a scheduled job, when the dispatcher's route has one. */
export function routeStop(deal: Deal, techId: string): number | undefined {
  return deal.scheduledDate ? deal.sequences?.[techId] : undefined;
}

/** Where a row opens: the technician's own job page. */
export const myJobHref = (dealId: string): string => `/my-jobs/${dealId}`;
