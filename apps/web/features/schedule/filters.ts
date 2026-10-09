import { JobSuperStatus, type Deal } from "@bitcrm/types";

/** One pick in "Filter results" — the kit's `WzFilterPick`. */
export interface SchedulePick {
  group: string;
  value: string;
}

/** The groups of Workiz's schedule filter we have (it also has TYPE: Jobs/Leads/Tasks/Events/Visit). */
export const FILTER_GROUP = {
  team: "team",
  tags: "tags",
  status: "status",
  jobType: "job_type",
  areas: "areas",
} as const;

/** STATUS, in Workiz's order and words (pg_schedule_wz_14c_filter_menu). */
export const SCHEDULE_STATUS_OPTIONS: { value: JobSuperStatus; label: string }[] = [
  { value: JobSuperStatus.SUBMITTED, label: "Submitted" },
  { value: JobSuperStatus.IN_PROGRESS, label: "In progress" },
  { value: JobSuperStatus.CANCELED, label: "Canceled" },
  { value: JobSuperStatus.DONE, label: "Done" },
  { value: JobSuperStatus.PENDING, label: "Pending" },
  { value: JobSuperStatus.DONE_PENDING_APPROVAL, label: "Done pending approval" },
];

const picked = (picks: readonly SchedulePick[], group: string) =>
  picks.filter((p) => p.group === group).map((p) => p.value);

/**
 * The jobs the calendar draws under the picks: any of the picked values
 * within a group, every group at once. A canceled job is off the calendar
 * unless Canceled is picked under STATUS.
 */
export function applyScheduleFilter(deals: Deal[], picks: readonly SchedulePick[]): Deal[] {
  const team = picked(picks, FILTER_GROUP.team);
  const tags = picked(picks, FILTER_GROUP.tags);
  const statuses = picked(picks, FILTER_GROUP.status);
  const types = picked(picks, FILTER_GROUP.jobType);
  const areas = picked(picks, FILTER_GROUP.areas);
  return deals.filter((d) => {
    if (statuses.length ? !statuses.includes(d.superStatus) : d.superStatus === JobSuperStatus.CANCELED) return false;
    if (team.length && !d.assignedTechIds.some((t) => team.includes(t))) return false;
    if (tags.length && !(d.tagIds ?? []).some((t) => tags.includes(t))) return false;
    if (types.length && !types.includes(d.jobTypeId)) return false;
    if (areas.length && !areas.includes(d.serviceArea)) return false;
    return true;
  });
}

/** The technicians picked under TEAM — the only Timeline rows then — or null for all of them. */
export function pickedTechIds(picks: readonly SchedulePick[]): string[] | null {
  const team = picked(picks, FILTER_GROUP.team);
  return team.length ? team : null;
}
