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

/**
 * The catalog order: priority desc, then name. The Workiz import gives each
 * tag its place in Workiz's catalog as `priority` (first of N → N), so this
 * is Workiz's order — oldest tag first — with tags made here (0) after.
 */
const byCatalogOrder = (a: JobTag, b: JobTag) => b.priority - a.priority || a.name.localeCompare(b.name);

/** Active tags only, sorted for pickers (priority desc, then name). */
export function activeJobTags(jobTags: JobTag[] | undefined): JobTag[] {
  return (jobTags ?? []).filter((t) => t.active).sort(byCatalogOrder);
}

/**
 * A job's tags the way Workiz prints them, in the list and in the job's
 * header alike: in catalog order, whatever order the job keeps them in.
 * An archived tag keeps its place; one the catalog does not know goes last;
 * until the catalog is in, the job's own order stands. A copy — the stored
 * list is left alone.
 */
export function jobTagsInCatalogOrder(tagIds: string[] | undefined, jobTags: JobTag[] | undefined): string[] {
  const ids = [...(tagIds ?? [])];
  if (!jobTags) return ids;
  const map = jobTagMap(jobTags);
  const known = ids.filter((id) => map.has(id));
  const unknown = ids.filter((id) => !map.has(id));
  return [...known.sort((a, b) => byCatalogOrder(map.get(a)!, map.get(b)!)), ...unknown];
}

/** The "+" window's "Sort by" orders, as in Workiz. */
export type JobTagSort = "az" | "za" | "newest" | "oldest";

/**
 * The "+" window's list. "Newest first" (Workiz's default, job_b_02_tags_add:
 * "waiting for docs", "Kobi - Austin Sub" …) is the catalog backwards: imported
 * tags share the import's `createdAt`, so among them the lowest `priority` is
 * the newest; a tag made here since is newer than all of them. "Oldest first"
 * is the catalog order.
 */
export function sortJobTags(tags: JobTag[], sort: JobTagSort): JobTag[] {
  const byName = (a: JobTag, b: JobTag) => a.name.localeCompare(b.name);
  const oldestFirst = (a: JobTag, b: JobTag) =>
    a.createdAt.localeCompare(b.createdAt) || b.priority - a.priority || byName(a, b);
  const sorted = [...tags];
  switch (sort) {
    case "az":
      return sorted.sort(byName);
    case "za":
      return sorted.sort((a, b) => byName(b, a));
    case "newest":
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.priority - b.priority || byName(a, b));
    case "oldest":
      return sorted.sort(oldestFirst);
  }
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

/**
 * The solid form Workiz uses in the jobs list: the tag's colour fills the
 * chip and the words are white capitals. A dispatcher scanning a long list
 * reads the colour first, so the outlined form recedes too far there.
 */
const TAG_SOLID_CLASSES: Record<JobTagColor, string> = {
  slate: "bg-slate-500 text-white",
  red: "bg-red-600 text-white",
  amber: "bg-amber-600 text-white",
  green: "bg-green-600 text-white",
  teal: "bg-teal-600 text-white",
  blue: "bg-blue-600 text-white",
  violet: "bg-violet-600 text-white",
  pink: "bg-pink-600 text-white",
};

export const tagSolidClasses = (color: JobTagColor): string =>
  TAG_SOLID_CLASSES[color] ?? TAG_SOLID_CLASSES.slate;
