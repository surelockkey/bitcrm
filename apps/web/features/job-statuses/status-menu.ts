import { JobSuperStatus, type DealSubStatus, type JobTagColor } from "@bitcrm/types";
import { superStatusLabel } from "@/features/deals/lib";
import { activeJobStatuses } from "./lib";

/** A bare super-status is picked through this prefix; a sub-status by its own id. */
export const SUPER_PREFIX = "SUPER::";

/**
 * The super-statuses in the order Workiz's job-page status menu lists them
 * (measured on job_b_02_status_open) — not the pipeline order the rest of
 * BitCRM uses, because this menu is where a dispatcher looks for them.
 */
export const STATUS_MENU_ORDER: JobSuperStatus[] = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.CANCELED,
  JobSuperStatus.DONE,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
];

/** Workiz's dot colour per super-status (its `colorClasses-module__color*`). */
const SUPER_DOT: Record<JobSuperStatus, string> = {
  [JobSuperStatus.SUBMITTED]: "#6aa8ee",
  [JobSuperStatus.IN_PROGRESS]: "#d574e4",
  [JobSuperStatus.CANCELED]: "#ff6f64",
  [JobSuperStatus.DONE]: "#3acf7d",
  [JobSuperStatus.PENDING]: "#fbab33",
  [JobSuperStatus.DONE_PENDING_APPROVAL]: "#9ea6aa",
};

export const superDotColor = (s: JobSuperStatus): string => SUPER_DOT[s] ?? SUPER_DOT[JobSuperStatus.SUBMITTED];

export type StatusMenuRow =
  | { kind: "super"; value: string; label: string; superStatus: JobSuperStatus }
  | { kind: "sub"; value: string; label: string; superStatus: JobSuperStatus; color: JobTagColor };

/**
 * One flat list for the menu: each super-status, then its active sub-statuses
 * indented under it. Unlike Workiz, a super-status that has sub-statuses stays
 * selectable on its own — BitCRM has always allowed a bare status.
 */
export function statusMenuRows(list: DealSubStatus[] | undefined): StatusMenuRow[] {
  const active = activeJobStatuses(list);
  return STATUS_MENU_ORDER.flatMap((group): StatusMenuRow[] => [
    { kind: "super", value: `${SUPER_PREFIX}${group}`, label: superStatusLabel(group), superStatus: group },
    ...active
      .filter((s) => s.group === group)
      .map((s): StatusMenuRow => ({ kind: "sub", value: s.id, label: s.name, superStatus: group, color: s.color })),
  ]);
}

/** The menu value of a job's current status. */
export function statusMenuValue(v: { superStatus: JobSuperStatus; subStatusId?: string }): string {
  return v.subStatusId || `${SUPER_PREFIX}${v.superStatus}`;
}
