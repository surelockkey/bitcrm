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
