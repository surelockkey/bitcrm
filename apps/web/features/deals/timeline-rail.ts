import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";

/**
 * What the job page's right rail and its Timeline panel decide: which
 * filter shows which entries, the counts beside each option, the red badge
 * on the notes icon and Workiz's "a day ago" times.
 */

export type TimelineFilter = "all" | "notes" | "activities" | "calls";

/** The client card's History panel order (unchanged). */
export const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "activities", label: "Activities" },
  { key: "calls", label: "Calls" },
];

/**
 * The job Timeline's dropdown, in Workiz's order. Workiz also has
 * "Messages"; BitCRM has no per-job message feed, so the option is left out
 * (the rail's chat icon opens the client's SMS thread instead).
 */
export const JOB_TIMELINE_FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "activities", label: "Activities" },
  { key: "notes", label: "Notes" },
  { key: "calls", label: "Calls" },
];

const CALL_EVENTS = new Set<string>([TimelineEventType.CALL_LINKED, TimelineEventType.CALL_UNLINKED]);

export function matchesFilter(entry: TimelineEntry, filter: TimelineFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "notes":
      return entry.eventType === TimelineEventType.NOTE_ADDED;
    case "calls":
      return CALL_EVENTS.has(entry.eventType);
    case "activities":
      // Everything the system recorded that isn't a note or a call.
      return entry.eventType !== TimelineEventType.NOTE_ADDED && !CALL_EVENTS.has(entry.eventType);
  }
}

export function timelineCounts(entries: TimelineEntry[]): Record<TimelineFilter, number> {
  const counts: Record<TimelineFilter, number> = { all: 0, activities: 0, notes: 0, calls: 0 };
  for (const e of entries) {
    for (const f of JOB_TIMELINE_FILTERS) if (matchesFilter(e, f.key)) counts[f.key] += 1;
  }
  return counts;
}

/** "Activities (58)"; "Notes (6+)" while older pages could still add to it. */
export function filterOptionLabel(filter: TimelineFilter, count: number, hasMore: boolean): string {
  const label = JOB_TIMELINE_FILTERS.find((f) => f.key === filter)?.label ?? filter;
  return `${label} (${count}${hasMore ? "+" : ""})`;
}

/** The red count on the rail's notes icon; nothing when there are none. */
export function notesBadge(count: number, hasMore: boolean): string | null {
  if (count <= 0) return null;
  if (count > 99) return "99+";
  return hasMore ? `${count}+` : String(count);
}

/**
 * "a day ago", "7 hours ago" — the wording (and the rounding thresholds) of
 * the moment.js `fromNow` Workiz prints its timeline with.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const s = Math.max(0, Math.round((now.getTime() - then) / 1000));
  const m = Math.round(s / 60);
  const h = Math.round(m / 60);
  const d = Math.round(h / 24);
  if (s < 45) return "a few seconds ago";
  if (s < 90) return "a minute ago";
  if (m < 45) return `${m} minutes ago`;
  if (m < 90) return "an hour ago";
  if (h < 22) return `${h} hours ago`;
  if (h < 36) return "a day ago";
  if (d < 26) return `${d} days ago`;
  if (d < 45) return "a month ago";
  if (d < 320) return `${Math.round(d / 30.4)} months ago`;
  if (d < 548) return "a year ago";
  return `${Math.round(d / 365)} years ago`;
}
