import type { Deal } from "@bitcrm/types";
import { parseSlot } from "./lib";

/**
 * The Workiz Schedule's calendar arithmetic (a DHTMLX Scheduler on
 * app.workiz.com/root/schedule/, captures `pg_schedule_wz_*`): its five
 * views, Sunday-first weeks, the month grid, the words beside the arrows,
 * where a job sits and how overlapping jobs share a column.
 *
 * Dates are `YYYY-MM-DD` strings, as deals carry them, and are stepped in
 * UTC so no daylight-saving day is ever 23 or 25 hours long.
 */

export type ScheduleView = "day" | "week" | "month" | "timeline" | "timeline_week";

/** Workiz's view picker, left to right. */
export const SCHEDULE_VIEWS: { value: ScheduleView; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "timeline", label: "Timeline" },
  { value: "timeline_week", label: "Timeline Week" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `iso` moved by whole days. */
export function addDays(iso: string, days: number): string {
  return toISO(parse(iso) + days * MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return new Date(parse(iso)).getUTCDay();
}

/** "Sun" … "Sat". */
export function weekdayName(iso: string): string {
  return WEEKDAYS[weekdayOf(iso)];
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / MS_PER_DAY);
}

/** The Sunday-to-Saturday week around a day — Workiz's weeks start on Sunday. */
export function weekOf(iso: string): string[] {
  const sunday = addDays(iso, -weekdayOf(iso));
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

function monthBounds(iso: string): { first: string; last: string } {
  const d = new Date(parse(iso));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    first: toISO(Date.UTC(y, m, 1)),
    last: toISO(Date.UTC(y, m + 1, 0)),
  };
}

/** The month grid: whole Sunday-first weeks from the one holding the 1st to the one holding the last day. */
export function monthWeeks(iso: string): string[][] {
  const { first, last } = monthBounds(iso);
  const rows: string[][] = [];
  for (let start = weekOf(first)[0]; start <= last; start = addDays(start, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return rows;
}

/** The visit days a view asks the server for. Month asks for its own month, as Workiz does. */
export function viewRange(view: ScheduleView, iso: string): { from: string; to: string } {
  if (view === "day" || view === "timeline") return { from: iso, to: iso };
  if (view === "month") {
    const { first, last } = monthBounds(iso);
    return { from: first, to: last };
  }
  const week = weekOf(iso);
  return { from: week[0], to: week[6] };
}

/** ‹ / ›: a day, a week, or a month (the day kept where the next month has it). */
export function stepDate(view: ScheduleView, iso: string, dir: 1 | -1): string {
  if (view === "day" || view === "timeline") return addDays(iso, dir);
  if (view === "week" || view === "timeline_week") return addDays(iso, 7 * dir);
  const d = new Date(parse(iso));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + dir;
  const lastOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(Date.UTC(y, m, Math.min(d.getUTCDate(), lastOfTarget)));
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** The title beside the arrows: "October 2026", or "Fri, October 9th, 2026" on the Timeline. */
export function scheduleTitle(view: ScheduleView, iso: string): string {
  const d = new Date(parse(iso));
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  if (view === "timeline") return `${WEEKDAYS[d.getUTCDay()]}, ${month} ${ordinal(d.getUTCDate())}, ${year}`;
  return `${month} ${year}`;
}

/** The day/week gutter: a big hour and a small AM/PM ("7" "AM"). */
export function hourLabel(hour: number): { h: string; m: string } {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { h: String(h12), m: hour < 12 ? "AM" : "PM" };
}

/** The Timeline's hour header: "12 AM", "01 AM" … "11 PM". */
export function timelineHourLabel(hour: number): string {
  const { h, m } = hourLabel(hour);
  return `${h.padStart(2, "0")} ${m}`;
}

/** Minutes since midnight as the month view prints a start: "7:30 AM". */
export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const { h, m } = hourLabel(hour);
  return `${h}:${String(minutes % 60).padStart(2, "0")} ${m}`;
}

/** Today by the browser's clock — the day Workiz's calendar circles. */
export function localTodayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Minutes since midnight by the browser's clock. */
export function localMinutes(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/* ------------------------------------------------------------ placement */

export interface ScheduleItem {
  deal: Deal;
  startDate: string;
  endDate: string;
  /** Minutes since midnight on the start day (0 for an all-day job). */
  startMin: number;
  /** Minutes since midnight on the end day (1440 for an all-day job). */
  endMin: number;
  /**
   * Drawn as a bar — the strip over the day/week grid, a bar across the month
   * — rather than a box in the hours: an all-day job, a dated job with no
   * times, or one that runs over more than one day.
   */
  bar: boolean;
}

/** Where a job sits on the calendar; `null` for one with no visit date. */
export function scheduleItem(deal: Deal): ScheduleItem | null {
  if (!deal.scheduledDate) return null;
  const startDate = deal.scheduledDate;
  const endDate = deal.scheduledEndDate && deal.scheduledEndDate > startDate ? deal.scheduledEndDate : startDate;
  const slot = deal.allDay ? null : parseSlot(deal.scheduledTimeSlot);
  if (!slot) return { deal, startDate, endDate, startMin: 0, endMin: 1440, bar: true };
  return { deal, startDate, endDate, startMin: slot.start, endMin: slot.end, bar: endDate !== startDate };
}

/**
 * How jobs that overlap share one day column — the DHTMLX day view: each job
 * takes the lowest column free at its start, and every job of a chain of
 * overlaps is as narrow as the chain's widest moment. Back-to-back jobs do not
 * overlap; a zero-length job still holds its place.
 */
export function layoutColumn(
  items: { id: string; startMin: number; endMin: number }[],
): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const effEnd = (it: { startMin: number; endMin: number }) => Math.max(it.endMin, it.startMin + 1);

  let chain: { id: string; col: number }[] = [];
  let chainEnd = -1;
  let colEnds: number[] = [];
  const flush = () => {
    const cols = colEnds.length;
    for (const c of chain) out.set(c.id, { col: c.col, cols });
    chain = [];
    colEnds = [];
    chainEnd = -1;
  };

  for (const it of sorted) {
    if (chain.length && it.startMin >= chainEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(effEnd(it));
    } else {
      colEnds[col] = effEnd(it);
    }
    chain.push({ id: it.id, col });
    chainEnd = Math.max(chainEnd, effEnd(it));
  }
  flush();
  return out;
}

/** Bars stacked into rows: each takes the first row free over its whole span. */
export function layoutLanes(
  items: { id: string; start: number; end: number }[],
): { lanes: Map<string, number>; count: number } {
  const lanes = new Map<string, number>();
  const ends: number[] = [];
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const it of sorted) {
    const end = Math.max(it.end, it.start + 1e-6);
    let lane = ends.findIndex((e) => e <= it.start);
    if (lane === -1) {
      lane = ends.length;
      ends.push(end);
    } else {
      ends[lane] = end;
    }
    lanes.set(it.id, lane);
  }
  return { lanes, count: ends.length };
}

/* ------------------------------------------------------------- the words */

/**
 * The words on a job — this account's Workiz schedule template,
 * `{{job_id}}\n{{job_type}},\n{{city}} , {{job_address}} \n{{tech_assigned}} `
 * (schedule_settings), with "N/A" for a job without a type and "Unassigned"
 * for one without a technician, as Workiz prints them.
 */
export function scheduleText(deal: Deal, { jobType, techs }: { jobType: string; techs: string[] }): string {
  const a = deal.address;
  const stateZip = [a?.state, a?.zip].filter(Boolean).join(" ");
  const address = [a?.street, a?.city, stateZip].filter(Boolean).join(", ");
  const crew = techs.length ? techs.join(",") : "Unassigned";
  return `${deal.dealNumber}\n${jobType || "N/A"},\n${a?.city ?? ""} , ${address} \n${crew} `;
}

/* ------------------------------------------------------------ the colours */

/**
 * Workiz's event colours, `.bgc1` … `.bgc39` read off its stylesheet
 * (pg_schedule_wz_* `palette` probe): CSS named colours, aquamarine first.
 */
export const WZ_EVENT_COLORS = [
  "#7fffd4", "#1e90ff", "#6495ed", "#008b8b", "#5f9ea0", "#00008b", "#2e8b57", "#556b2f",
  "#8fbc8f", "#9acd32", "#bdb76b", "#808000", "#deb887", "#d2b48c", "#cd853f", "#b8860b",
  "#d2691e", "#a52a2a", "#ffa500", "#ff8c00", "#ff6347", "#ff4500", "#dc143c", "#8b0000",
  "#ee82ee", "#da70d6", "#db7093", "#bc8f8f", "#8a2be2", "#191970", "#3cb371", "#008000",
  "#20b2aa", "#4169e1", "#2f4f4f", "#708090", "#f0e68c", "#000000", "#5e5e5e",
] as const;

/** Workiz's default event colour (`.dhx_cal_event` with no `bgcN`): time off and the like. */
export const WZ_DEFAULT_EVENT_COLOR = "#61747d";

function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return h >>> 0;
}

/**
 * A job's colour. The account colours jobs by service area ("Color Job By:
 * Service Area"), each area keeping one of Workiz's colours — `stored`, the
 * area's own `#rrggbb` (imported from Workiz's `color_class`). An area
 * without one gets a colour its name picks, the same every time.
 */
export function scheduleColor(key: string | undefined, stored?: string): string {
  if (stored && /^#[0-9a-f]{6}$/i.test(stored)) return stored.toLowerCase();
  if (!key) return WZ_EVENT_COLORS[0];
  return WZ_EVENT_COLORS[hash(key) % WZ_EVENT_COLORS.length];
}
