import { JobSuperStatus, type Deal } from "@bitcrm/types";

/**
 * The Map's "Filters" panel (pg_dispatch_wz_09_filter_*): Technician
 * ("Unassigned" first, then everyone A→Z), Service Area and Status — open
 * statuses only — as ticks, applied together. Job Type is ours, ticked the
 * same way. Nothing ticked in a section lets every job through it.
 */

/** The "Unassigned" tick of the Technician section. */
export const UNASSIGNED = "__unassigned";

/** Status, in Workiz's order: the Map shows open jobs only. */
export const MAP_STATUSES: readonly JobSuperStatus[] = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
];

/**
 * Ours, after Workiz's four (kept from before the Workiz pass): the finished
 * and the canceled jobs — today's or this week's Done ones on the map. Read
 * only once ticked, and only for the date box's days.
 */
export const MAP_CLOSED_STATUSES: readonly JobSuperStatus[] = [JobSuperStatus.DONE, JobSuperStatus.CANCELED];

/**
 * What to read besides the open jobs: the ticked closed statuses over the
 * date box's days — nothing when none is ticked, or for Any date (closed jobs
 * of every date are hundreds of thousands of rows).
 */
export function closedMapWindow(
  f: MapFilters,
  days: { from?: string; to?: string },
): { from: string; to: string; statuses: JobSuperStatus[] } | null {
  const statuses = MAP_CLOSED_STATUSES.filter((s) => f.statuses.includes(s));
  if (!statuses.length || !days.from || !days.to) return null;
  return { from: days.from, to: days.to, statuses };
}

/**
 * The sidebar's count: among the open jobs, as Workiz says it; among every
 * job held once Done / Canceled are read in; and why none of those show for
 * Any date.
 */
export function mapFoundText({
  shown,
  open,
  closed,
  closedNeedDays = false,
}: {
  shown: number;
  open: number;
  /** Done / Canceled jobs read in for the date box's days, when ticked. */
  closed?: number;
  closedNeedDays?: boolean;
}): string {
  if (closed !== undefined) return `Found ${shown} out of ${open + closed} jobs`;
  const text = `Found ${shown} out of ${open} open jobs`;
  return closedNeedDays ? `${text} · pick Day, Week or Month for Done / Canceled` : text;
}

export interface MapFilters {
  techIds: string[];
  /** Service-area names (a job carries its area by name). */
  areas: string[];
  statuses: JobSuperStatus[];
  jobTypeIds: string[];
}

export const EMPTY_MAP_FILTERS: MapFilters = { techIds: [], areas: [], statuses: [], jobTypeIds: [] };

export function matchesMapFilters(deal: Deal, f: MapFilters): boolean {
  if (f.techIds.length) {
    const nobody = deal.assignedTechIds.length === 0;
    const hit = (nobody && f.techIds.includes(UNASSIGNED)) || deal.assignedTechIds.some((t) => f.techIds.includes(t));
    if (!hit) return false;
  }
  if (f.areas.length && !f.areas.includes(deal.serviceArea)) return false;
  if (f.statuses.length && !f.statuses.includes(deal.superStatus)) return false;
  if (f.jobTypeIds.length && !f.jobTypeIds.includes(deal.jobTypeId)) return false;
  return true;
}

export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function countMapFilters(f: MapFilters): number {
  return f.techIds.length + f.areas.length + f.statuses.length + f.jobTypeIds.length;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** A→Z ignoring case, as the panel lists its techs and areas. */
export function sortByName<T extends { label: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => collator.compare(a.label, b.label));
}
