import { JobSuperStatus } from "@bitcrm/types";
import type { Address, Deal } from "@bitcrm/types";

/* ------------------------------------------------------------------ dates */

const pad = (n: number) => String(n).padStart(2, "0");

/** The device's local calendar day as YYYY-MM-DD — a technician's "today". */
export function localDateIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** YYYY-MM-DD shifted by `days` (calendar arithmetic, no timezone drift). */
export function shiftDateIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateIso(d);
}

/** "9:00 AM" from "09:00"; the input echoed back when it isn't HH:MM. */
export function formatClock(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m[2]} ${suffix}`;
}

/**
 * The time a card leads with: "9:00 AM – 12:00 PM", "All day", or "No time"
 * for a dated job without a slot (the dispatcher hasn't set one yet).
 */
export function formatSlot(slot: string | undefined, allDay: boolean | undefined): string {
  if (allDay) return "All day";
  if (!slot) return "No time";
  const [start, end] = slot.split("-").map((s) => s.trim());
  if (!start) return "No time";
  return end && end !== start ? `${formatClock(start)} – ${formatClock(end)}` : formatClock(start);
}

/** "Wed, Sep 23" — the heading for a day that isn't today or tomorrow. */
export function formatDayHeading(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/* ---------------------------------------------------------------- groups */

/** Statuses a technician is finished with — dropped from earlier days. */
const CLOSED: ReadonlySet<JobSuperStatus> = new Set([
  JobSuperStatus.DONE,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  JobSuperStatus.CANCELED,
]);

export const isClosedJob = (d: Pick<Deal, "superStatus">): boolean => CLOSED.has(d.superStatus);

export type JobDayKey = "overdue" | "today" | "tomorrow" | "unscheduled" | `day:${string}`;

export interface JobDayGroup {
  key: JobDayKey;
  label: string;
  /** The calendar day this group is for (absent for overdue/unscheduled). */
  dateIso?: string;
  deals: Deal[];
}

/** Slot start as "HH:MM" for sorting; "~" sorts undated/untimed jobs last. */
const slotStart = (d: Deal): string => {
  const start = d.scheduledTimeSlot?.split("-")[0]?.trim();
  return start && /^\d{2}:\d{2}$/.test(start) ? start : "~";
};

/**
 * Visit order inside a day: the technician's own route position when the
 * dispatcher set one (`sequences[techId]`), then the slot start, then the
 * job number so the order is stable.
 */
export function compareVisitOrder(a: Deal, b: Deal, techId?: string): number {
  const sa = techId ? a.sequences?.[techId] : undefined;
  const sb = techId ? b.sequences?.[techId] : undefined;
  if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
  if (sa !== undefined && sb === undefined) return -1;
  if (sa === undefined && sb !== undefined) return 1;
  const ta = slotStart(a);
  const tb = slotStart(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a.dealNumber).localeCompare(String(b.dealNumber));
}

/**
 * A technician's jobs as the day list they work from, Workiz-style: what is
 * still open from earlier days first (it needs attention), then today, then
 * tomorrow and each later day under its own heading, and finally the jobs
 * assigned to them that have no date yet. Closed jobs (Done / Canceled)
 * survive only on today's list — yesterday's finished work is history, not
 * a to-do — and every day is in visit order.
 */
export function groupJobsByDay(
  deals: Deal[],
  todayIso: string,
  techId?: string,
): JobDayGroup[] {
  const tomorrowIso = shiftDateIso(todayIso, 1);
  const overdue: Deal[] = [];
  const unscheduled: Deal[] = [];
  const byDay = new Map<string, Deal[]>();

  for (const d of deals) {
    const day = d.scheduledDate?.slice(0, 10);
    if (!day) {
      if (!isClosedJob(d)) unscheduled.push(d);
      continue;
    }
    if (day < todayIso) {
      if (!isClosedJob(d)) overdue.push(d);
      continue;
    }
    const list = byDay.get(day) ?? [];
    list.push(d);
    byDay.set(day, list);
  }

  const sort = (list: Deal[]) => [...list].sort((a, b) => compareVisitOrder(a, b, techId));
  const groups: JobDayGroup[] = [];

  if (overdue.length) {
    groups.push({ key: "overdue", label: "Still open from earlier", deals: sort(overdue) });
  }
  // Today always shows, even empty, so the page has an anchor for the day.
  groups.push({ key: "today", label: "Today", dateIso: todayIso, deals: sort(byDay.get(todayIso) ?? []) });

  const later = [...byDay.keys()].filter((day) => day > todayIso).sort();
  for (const day of later) {
    if (day === tomorrowIso) {
      groups.push({ key: "tomorrow", label: "Tomorrow", dateIso: day, deals: sort(byDay.get(day)!) });
    } else {
      groups.push({ key: `day:${day}`, label: formatDayHeading(day), dateIso: day, deals: sort(byDay.get(day)!) });
    }
  }

  if (unscheduled.length) {
    groups.push({ key: "unscheduled", label: "Not scheduled yet", deals: sort(unscheduled) });
  }
  return groups;
}

/* --------------------------------------------------------------- address */

/** One-line service address for a card; empty when nothing is filled in. */
export function addressLine(a: Address | undefined): string {
  if (!a) return "";
  const street = [a.street, a.unit].filter(Boolean).join(", ");
  const locality = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, locality].filter(Boolean).join(", ");
}

/**
 * Tap-to-navigate link. Google Maps' universal directions URL opens the
 * installed Maps app on both iOS and Android (and the website on a laptop);
 * coordinates win over the typed address when the job was geocoded, so a
 * misspelt street still leads to the right door.
 */
export function navigationUrl(a: Address | undefined): string | null {
  if (!a) return null;
  const dest =
    typeof a.lat === "number" && typeof a.lng === "number"
      ? `${a.lat},${a.lng}`
      : addressLine(a);
  if (!dest) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/* --------------------------------------------------------------- actions */

/**
 * Which technician actions a job offers, from what has already happened to
 * it. Mirrors the Workiz mobile flow: confirm receipt → on my way → arrived →
 * start (In Progress) → done. A closed job offers nothing but a call.
 */
export interface TechActionState {
  /** "Confirm receipt" — until somebody has acknowledged the job. */
  canConfirm: boolean;
  /** "On my way" / "Running late" texts to the client — while the job is open. */
  canNotify: boolean;
  /** "Arrived" — once, on an open job. */
  canArrive: boolean;
  /** "Start" — Submitted → In Progress. */
  canStart: boolean;
  /** "Done" — In Progress (or Pending) → Done. */
  canFinish: boolean;
}

export function techActionState(deal: Pick<Deal, "superStatus" | "techConfirmedAt" | "arrivedAt">): TechActionState {
  const closed = isClosedJob(deal);
  return {
    canConfirm: !closed && !deal.techConfirmedAt,
    canNotify: !closed,
    canArrive: !closed && !deal.arrivedAt,
    canStart: deal.superStatus === JobSuperStatus.SUBMITTED,
    canFinish: deal.superStatus === JobSuperStatus.IN_PROGRESS || deal.superStatus === JobSuperStatus.PENDING,
  };
}

/* ----------------------------------------------------------------- stock */

/** The fields "My stock" searches on — name, SKU, category. */
export interface SearchableStockRow {
  name: string;
  sku?: string;
  category?: string;
}

/**
 * Filter the van's stock by what the technician typed. Every word has to
 * match something — a part is found by name, by the number on the box (SKU),
 * or by the shelf it lives on (category), and "3/4 valve" finds the 3/4"
 * valve even though the two words come from different fields.
 */
export function filterStockRows<T extends SearchableStockRow>(rows: T[], query: string): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((r) => {
    const haystack = [r.name, r.sku, r.category].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** Low stock first (that is what needs a restock), then by name. */
export function sortStockRows<T extends SearchableStockRow & { isLow: boolean }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Number(b.isLow) - Number(a.isLow) || a.name.localeCompare(b.name),
  );
}
