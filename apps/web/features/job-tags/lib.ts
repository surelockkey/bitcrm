import type { JobTag, JobTagColor } from "@bitcrm/types";
import { useJobTags } from "./hooks";

/** Build an id → tag lookup from the catalog list. */
export function jobTagMap(jobTags: JobTag[] | undefined): Map<string, JobTag> {
  return new Map((jobTags ?? []).map((t) => [t.id, t]));
}

/**
 * Resolve a job-tag id to its display name. Falls back to the raw id (rather
 * than an empty cell) so a deal referencing a purged tag still shows something.
 */
export function jobTagName(id: string | undefined, jobTags: JobTag[] | undefined): string {
  if (!id) return "—";
  return jobTagMap(jobTags).get(id)?.name ?? id;
}

/** Hook wrapper for components that only need the name resolver. */
export function useJobTagName(): (id: string | undefined) => string {
  const { data } = useJobTags();
  return (id) => jobTagName(id, data);
}

/** Active tags only, sorted for pickers (priority desc, then name). */
export function activeJobTags(jobTags: JobTag[] | undefined): JobTag[] {
  return (jobTags ?? [])
    .filter((t) => t.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/**
 * Palette token → chip classes, legible in light and dark. One string per
 * JobTagColor (the enum in @bitcrm/types is the source of truth). Mirrors the
 * tone pattern used by the technician assignment chips.
 */
export const TAG_COLOR_CLASSES: Record<JobTagColor, string> = {
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  red: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  green: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  pink: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400",
};

/** Solid swatch classes (for the color picker dots). */
export const TAG_SWATCH_CLASSES: Record<JobTagColor, string> = {
  slate: "bg-slate-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export const tagColorClasses = (color: JobTagColor): string =>
  TAG_COLOR_CLASSES[color] ?? TAG_COLOR_CLASSES.slate;
