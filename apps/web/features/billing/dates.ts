/**
 * Day-precision helpers for billing documents. Invoice/estimate dates are
 * plain `YYYY-MM-DD` strings — they must never pass through UTC, or a date
 * picked in Phoenix shows up as the day before. Today is Connecticut's
 * (`ctToday` in `@/lib/timezone`), never the browser's.
 */

import { DEFAULT_TZ } from "@/lib/timezone";

const pad = (n: number) => String(n).padStart(2, "0");
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A Date → its local `YYYY-MM-DD` (calendar arithmetic only — not "today"). */
export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(s: string): Date | null {
  const m = YMD.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return ymdOf(d) === s ? d : null;
}

/** True for a real calendar day in `YYYY-MM-DD` form. */
export function isYmd(s: string | undefined | null): s is string {
  return typeof s === "string" && parseYmd(s) !== null;
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  d.setDate(d.getDate() + days);
  return ymdOf(d);
}

/**
 * A document's day as Workiz's estimate header prints it: "Thu Jun 18 2026"
 * (the browser's own day string, which Workiz shows as is). "" for no day.
 */
export function formatWzDocDate(value: string | undefined | null): string {
  if (!value) return "";
  const d = parseYmd(value);
  return d ? d.toDateString() : "";
}

/**
 * "Sep 1, 2026" for a `YYYY-MM-DD` day (as it is — a day is never shifted)
 * or an ISO instant (its day on Connecticut's calendar, whatever the
 * browser's — 23:30 EDT is still that day); "—" for anything else.
 */
export function formatYmd(value: string | undefined | null): string {
  if (!value) return "—";
  const day = parseYmd(value);
  if (day) return day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { timeZone: DEFAULT_TZ, month: "short", day: "numeric", year: "numeric" });
}
