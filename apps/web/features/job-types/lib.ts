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

/** Active types only, sorted for pickers (priority desc, then name). */
export function activeJobTypes(jobTypes: JobType[] | undefined): JobType[] {
  return (jobTypes ?? [])
    .filter((t) => t.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}
