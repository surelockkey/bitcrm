/**
 * Day-precision helpers for billing documents. Invoice/estimate dates are
 * plain `YYYY-MM-DD` strings — they must never pass through UTC, or a date
 * picked in Phoenix shows up as the day before.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A Date → its local `YYYY-MM-DD`. */
export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayYmd(now: Date = new Date()): string {
  return ymdOf(now);
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
 * "Sep 1, 2026" for a `YYYY-MM-DD` day (read as local) or an ISO instant
 * (shown in the viewer's timezone); "—" for anything else.
 */
export function formatYmd(value: string | undefined | null): string {
  if (!value) return "—";
  const d = parseYmd(value) ?? new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
