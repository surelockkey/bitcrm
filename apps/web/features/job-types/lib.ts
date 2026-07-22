import type { JobType } from "@bitcrm/types";
import { useJobTypes } from "./hooks";

/** Build an id → name lookup from the catalog list. */
export function jobTypeNameMap(jobTypes: JobType[] | undefined): Map<string, string> {
  return new Map((jobTypes ?? []).map((t) => [t.id, t.name]));
}

/**
 * Resolve a job-type id to its display name. Falls back to the raw id (rather
 * than an empty cell) so a deal referencing a purged type still shows something.
 * The single replacement for the old hardcoded `jobTypeLabel()` + `JOB_TYPES`.
 */
export function jobTypeName(id: string | undefined, jobTypes: JobType[] | undefined): string {
  if (!id) return "—";
  return jobTypeNameMap(jobTypes).get(id) ?? id;
}

/** Hook wrapper for components that only need the resolver. */
export function useJobTypeName(): (id: string | undefined) => string {
  const { data } = useJobTypes();
  return (id) => jobTypeName(id, data);
}

/** Active types only, sorted for pickers (priority desc, then name). */
export function activeJobTypes(jobTypes: JobType[] | undefined): JobType[] {
  return (jobTypes ?? [])
    .filter((t) => t.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}
