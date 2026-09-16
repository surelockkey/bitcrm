import type { CallTag } from "@bitcrm/types";

/**
 * Call tags and job tags share one palette — the backend validates both
 * against `JOB_TAG_COLORS`, so the chip classes are imported rather than
 * copied: one tag chip style, two catalogs.
 */
export {
  TAG_COLOR_CLASSES,
  TAG_SWATCH_CLASSES,
  tagColorClasses,
} from "@/features/job-tags/lib";

/** Build an id → tag lookup from the catalog list. */
export function callTagMap(tags: CallTag[] | undefined): Map<string, CallTag> {
  return new Map((tags ?? []).map((t) => [t.id, t]));
}

/**
 * Active tags only, sorted for pickers (priority desc, then name) — archived
 * tags stay resolvable on old calls but leave every picker, which is exactly
 * what `DELETE /call-tags/:id` does on the server.
 */
export function activeCallTags(tags: CallTag[] | undefined): CallTag[] {
  return (tags ?? [])
    .filter((t) => t.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}
