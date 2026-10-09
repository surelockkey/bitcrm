/**
 * The Map's date box (pg_dispatch_wz_07 / _14): "Day | Week | Month", ‹ ›
 * and "Reset date". Workiz reads every open job once and shows the ones
 * scheduled inside the chosen days — Week is Sunday to Saturday, Month the
 * calendar month, and ‹ › step one of those at a time.
 */

export type MapRange = "day" | "week" | "month";

export const MAP_RANGES: readonly { value: MapRange; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The viewer's calendar day, YYYY-MM-DD — Workiz's date box follows the browser clock. */
export function localToday(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** YYYY-MM-DD → a UTC date (no time-zone drift in the arithmetic). */
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(isoDay: string, n: number): string {
  const d = parse(isoDay);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** The inclusive days a range covers around `anchor`. */
export function mapRangeWindow(range: MapRange, anchor: string): { from: string; to: string } {
  if (range === "day") return { from: anchor, to: anchor };
  const d = parse(anchor);
  if (range === "week") {
    const from = addDays(anchor, -d.getUTCDay());
    return { from, to: addDays(from, 6) };
  }
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: iso(first), to: iso(last) };
}

/** ‹ / ›: the anchor one range earlier or later (months from their 1st). */
export function shiftMapRange(range: MapRange, anchor: string, step: 1 | -1): string {
  if (range === "day") return addDays(anchor, step);
  if (range === "week") return addDays(anchor, 7 * step);
  const d = parse(anchor);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1)));
}

/** "Fri, Oct 9, 2026". */
function dayWords(isoDay: string): string {
  const d = parse(isoDay);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * The words in the date box, as Workiz splits them into two spans:
 * ["Sun, Oct 4, 2026 - ", "Sat, Oct 10, 2026"], or one for a Day.
 */
export function mapRangeLabel(range: MapRange, anchor: string): string[] {
  const { from, to } = mapRangeWindow(range, anchor);
  if (range === "day") return [dayWords(from)];
  return [`${dayWords(from)} - `, dayWords(to)];
}
