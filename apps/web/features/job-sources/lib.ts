import type { JobSource } from "@bitcrm/types";
import { useJobSources } from "./hooks";

/** Build an id → name lookup from the catalog list. */
export function jobSourceNameMap(jobSources: JobSource[] | undefined): Map<string, string> {
  return new Map((jobSources ?? []).map((t) => [t.id, t.name]));
}

/**
 * Resolve a job-source id to its display name. Falls back to the raw id (rather
 * than an empty cell) so a deal referencing a purged source still shows something.
 */
export function jobSourceName(id: string | undefined, jobSources: JobSource[] | undefined): string {
  if (!id) return "—";
  return jobSourceNameMap(jobSources).get(id) ?? id;
}

/** Hook wrapper for components that only need the resolver. */
export function useJobSourceName(): (id: string | undefined) => string {
  const { data } = useJobSources();
  return (id) => jobSourceName(id, data);
}

/** Active sources only, sorted for pickers (priority desc, then name). */
export function activeJobSources(jobSources: JobSource[] | undefined): JobSource[] {
  return (jobSources ?? [])
    .filter((t) => t.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}
