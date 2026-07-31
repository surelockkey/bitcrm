import type { DealStageGroup, DealSubStatus } from "@bitcrm/types";
import { GROUP_ORDER, groupLabel } from "@/features/deals/lib";
import { TAG_COLOR_CLASSES, TAG_SWATCH_CLASSES, tagColorClasses } from "@/features/job-tags/lib";
import { useJobStatuses } from "./hooks";

/** Build an id → status lookup from the catalog list. */
export function jobStatusMap(list: DealSubStatus[] | undefined): Map<string, DealSubStatus> {
  return new Map((list ?? []).map((s) => [s.id, s]));
}

/**
 * Resolve a sub-status id to its display name. Falls back to the raw id (rather
 * than an empty cell) so a deal referencing a purged status still shows
 * something; a dash when there's no status at all.
 */
export function jobStatusName(id: string | undefined, list: DealSubStatus[] | undefined): string {
  if (!id) return "—";
  return jobStatusMap(list).get(id)?.name ?? id;
}

/** Hook wrapper for components that only need the name resolver. */
export function useJobStatusName(): (id: string | undefined) => string {
  const { data } = useJobStatuses();
  return (id) => jobStatusName(id, data);
}

function byPriorityThenName(a: DealSubStatus, b: DealSubStatus): number {
  return b.priority - a.priority || a.name.localeCompare(b.name);
}

/** Active statuses only, sorted for pickers (priority desc, then name). */
export function activeJobStatuses(list: DealSubStatus[] | undefined): DealSubStatus[] {
  return (list ?? []).filter((s) => s.active).sort(byPriorityThenName);
}

/** A super-status with its sub-statuses, for grouped rendering. */
export interface JobStatusGroup {
  group: DealStageGroup;
  label: string;
  statuses: DealSubStatus[];
}

/**
 * Group sub-statuses under their super-status in pipeline order — the shape both
 * the Settings page and the job-page select render from.
 *
 * - `activeOnly` drops archived statuses (for the job-page picker).
 * - `includeEmpty` keeps super-statuses that have no sub-statuses yet (for the
 *   Settings page, so you can add under any of them).
 */
export function groupJobStatuses(
  list: DealSubStatus[] | undefined,
  opts: { activeOnly?: boolean; includeEmpty?: boolean } = {},
): JobStatusGroup[] {
  const src = opts.activeOnly
    ? activeJobStatuses(list)
    : (list ?? []).slice().sort(byPriorityThenName);

  const groups: JobStatusGroup[] = GROUP_ORDER.map((group) => ({
    group,
    label: groupLabel(group),
    statuses: src.filter((s) => s.group === group),
  }));

  return opts.includeEmpty ? groups : groups.filter((g) => g.statuses.length > 0);
}

/* ---------------------------------------------------------------- colors */
// Statuses share the job-tag palette; re-exported so status components import
// only from their own feature.
export const statusColorClasses = tagColorClasses;
export const STATUS_COLOR_CLASSES = TAG_COLOR_CLASSES;
export const STATUS_SWATCH_CLASSES = TAG_SWATCH_CLASSES;
