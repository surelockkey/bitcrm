/**
 * Days the way Workiz writes them — moment.js's `MMM Do, YYYY` ("Oct 8th,
 * 2026"): the date-range box on its list pages and the call log's Time column.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1 → "1st", 12 → "12th", 22 → "22nd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "2026-10-08" → "Oct 8th, 2026"; anything that is not a day → "". */
export function formatWzDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${ordinal(Number(m[3]))}, ${m[1]}`;
}

/** "Oct 8th, 2026 - Oct 8th, 2026" — both ends, even when they are one day. */
export function formatWzDayRange(from: string, to: string): string {
  return `${formatWzDay(from)} - ${formatWzDay(to)}`;
}
