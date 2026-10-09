import type { JobType } from "@bitcrm/types";
import { useJobTypes } from "./hooks";

/** Build an id → name lookup from the catalog list. */
export function jobTypeNameMap(jobTypes: JobType[] | undefined): Map<string, string> {
  return new Map((jobTypes ?? []).map((t) => [t.id, t.name]));
}

/**
 * Resolve a job-type id to its display name.
 *
 * An id that isn't in the catalog — a purged type, or the catalog still in
 * flight — reads as "Unknown type", never as the raw uuid: a 36-character id
 * in a job-type column tells nobody anything and reads like a bug. The single
 * replacement for the old hardcoded `jobTypeLabel()` + `JOB_TYPES`.
 */
export function jobTypeName(id: string | undefined, jobTypes: JobType[] | undefined): string {
  if (!id) return "—";
  return jobTypeNameMap(jobTypes).get(id) ?? "Unknown type";
}

/** Hook wrapper for components that only need the resolver. */
export function useJobTypeName(): (id: string | undefined) => string {
  const { data } = useJobTypes();
  return (id) => jobTypeName(id, data);
}

/**
 * Whether the catalog is still in flight.
 *
 * A table that prints `jobTypeName()` before it lands shows "Unknown type" and
 * then rewrites itself — a statement, and the wrong one. Callers that care
 * render a placeholder while this is true.
 */
export function useJobTypesLoading(): boolean {
  return useJobTypes().isLoading;
}

/** Active types only, sorted for pickers (priority desc, then name). */
export function activeJobTypes(jobTypes: JobType[] | undefined): JobType[] {
  return (jobTypes ?? [])
    .filter((t) => t.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------- duration */

/** What a job gets when its type has no duration of its own: Workiz's hour. */
export const DEFAULT_JOB_DURATION_MINUTES = 60;

/**
 * How long a job of this type is planned for — Workiz's Duration on the
 * job type (Days / Hours / Minutes), an hour when the type has none.
 */
export function jobTypeDurationMinutes(jobType: Pick<JobType, "durationMinutes"> | undefined): number {
  const minutes = jobType?.durationMinutes;
  return minutes && minutes > 0 ? minutes : DEFAULT_JOB_DURATION_MINUTES;
}

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
}

/** Minutes → Workiz's three boxes. */
export function splitDuration(totalMinutes: number | undefined): DurationParts {
  const total = Math.max(0, Math.round(totalMinutes ?? 0));
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

/** Workiz's three boxes → minutes. */
export function joinDuration({ days, hours, minutes }: DurationParts): number {
  return days * 1440 + hours * 60 + minutes;
}

/**
 * The Job Types grid's Duration column, in Workiz's words ("2 hours",
 * "1 hours" — it never singularises); days and minutes only when there are
 * any. A type without a duration shows the hour the pickers give it.
 */
export function formatJobTypeDuration(totalMinutes: number | undefined): string {
  const { days, hours, minutes } = splitDuration(jobTypeDurationMinutes({ durationMinutes: totalMinutes }));
  const parts: string[] = [];
  if (days) parts.push(`${days} days`);
  if (hours) parts.push(`${hours} hours`);
  if (minutes) parts.push(`${minutes} minutes`);
  return parts.join(" ");
}
