import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import { formatPhone } from "@/lib/phone";
import type { FeedMessage } from "@/features/messaging/api";

/**
 * What the job page's right rail and its Timeline panel decide: which
 * filter shows which entries, the counts beside each option, the red badge
 * on the notes icon and Workiz's "a day ago" times.
 */

export type TimelineFilter = "all" | "notes" | "activities" | "calls" | "messages";

/** The client card's History panel order (unchanged). */
export const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "activities", label: "Activities" },
  { key: "calls", label: "Calls" },
];

/**
 * The job Timeline's dropdown, in Workiz's order (rail_chat_dropdown).
 * "Messages" are the job's texts and emails — messaging's per-job feed —
 * which sit beside the timeline's entries rather than inside it.
 */
export const JOB_TIMELINE_FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "activities", label: "Activities" },
  { key: "notes", label: "Notes" },
  { key: "calls", label: "Calls" },
  { key: "messages", label: "Messages" },
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
    case "messages":
      // Messages are not timeline entries; they come from messaging.
      return false;
  }
}

/** The number beside each option; `messages` is how many of the job's messages are loaded. */
export function timelineCounts(entries: TimelineEntry[], messages = 0): Record<TimelineFilter, number> {
  const counts: Record<TimelineFilter, number> = { all: 0, activities: 0, notes: 0, calls: 0, messages };
  for (const e of entries) {
    for (const f of JOB_TIMELINE_FILTERS) if (matchesFilter(e, f.key)) counts[f.key] += 1;
  }
  counts.all += messages;
  return counts;
}

/* -------------------------------------------------------------- messages */

export interface MessageRowContext {
  userName: (id: unknown) => string | null;
  /** The job's client, who an inbound text from their number is from. */
  clientName?: string;
  /** Every number the job and its client carry, in any format. */
  clientPhones?: string[];
}

/** The last ten digits — enough to tell "(203) 769-9944" and "+12037699944" are one number. */
const lastTen = (p: string) => p.replace(/\D/g, "").slice(-10);

/**
 * Who wrote a message and what it said, as a Timeline row draws it
 * (rail_chat): the actor in the row's name slot — the sender of an outbound
 * line, the client or technician of an inbound one — and the text with its
 * line breaks.
 */
export function messageRowText(m: FeedMessage, ctx: MessageRowContext): { actor: string; text: string } {
  const user = ctx.userName(m.sentByUserId) ?? m.sentByName ?? null;
  const from = m.from ? formatPhone(m.from) : null;
  let actor: string;
  if (m.direction === "outbound") {
    actor = user ?? (m.origin === "automation" ? "Automation" : m.origin === "system" ? "System" : "—");
  } else if (m.origin === "employee") {
    actor = user ?? from ?? "Technician";
  } else {
    const own = !m.from || (ctx.clientPhones ?? []).some((p) => lastTen(p) === lastTen(m.from as string));
    actor = (own ? ctx.clientName : from) || from || ctx.clientName || "Client";
  }

  const files = m.attachments?.length ?? 0;
  const body = m.channel === "email" && m.subject && m.body ? `${m.subject}\n${m.body}` : m.body ?? m.subject;
  const text = body || (files ? `${files} attachment${files === 1 ? "" : "s"}` : "");
  return { actor, text };
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
