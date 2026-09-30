import { DASHBOARD_TIMEZONE } from '@bitcrm/types';

/**
 * The account's calendar for the Timesheets report.
 *
 * Workiz files a timesheet under the day its START falls on in the account's
 * zone — America/New_York for SLK — whoever punched it and wherever: a Dallas
 * clock-in at 23:30 local is the next day's row. The same calendar the Jobs
 * report and the dashboard speak (`DASHBOARD_TIMEZONE`), so the three agree on
 * what "Tuesday" is.
 *
 * Deliberately NOT `date-range.util.ts`: the technician's own `GET /timeclock`
 * reads whole UTC days, which is what the phone has always been sent. The
 * report is the office's question and uses the office's days.
 */
export const REPORT_TIMEZONE = DASHBOARD_TIMEZONE;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

let formatter: Intl.DateTimeFormat | undefined;

function wallParts(ms: number): Record<string, number> {
  formatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return Object.fromEntries(
    formatter.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]),
  );
}

/** How far the account's zone is ahead of UTC at `ms` (negative: behind). */
function offsetAt(ms: number): number {
  const p = wallParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** `YYYY-MM-DD` the account's wall calendar shows at `instant`; undefined if it does not parse. */
export function accountDay(instant: string): string | undefined {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + offsetAt(ms)).toISOString().slice(0, 10);
}

/** `YYYY-MM` of `instant` on the account's calendar — the TimeClockIndex partition. */
export function accountMonth(instant: string): string | undefined {
  return accountDay(instant)?.slice(0, 7);
}

/** The instant (ISO, ms precision) the account's day `day` begins. */
export function dayStartUtc(day: string): string {
  const naive = Date.parse(`${day}T00:00:00.000Z`);
  // Twice: the first guess can sit on the other side of a clock change.
  const first = naive - offsetAt(naive);
  return new Date(naive - offsetAt(first)).toISOString();
}

export function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

/** `day` moved by `days` calendar days. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both counted. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
}

/** Every `YYYY-MM` from `from`'s month to `to`'s, in order. */
export function monthsCovering(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
