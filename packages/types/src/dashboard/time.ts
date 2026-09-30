import { DEFAULT_TIMEZONE } from '../entities/service-area.entity';

/**
 * The dashboard's clock. Shared by the browser and the server on purpose: a
 * "Last 30 Days" window is a cache key, and the snapshot the nightly job
 * builds is only found if both sides name the same days.
 *
 * The business runs on Eastern time (Connecticut), so that is the calendar —
 * not the viewer's, and not UTC. A dispatcher in Dallas at 11pm still sees
 * the New York day, which is also the day the office's reports speak of.
 */
export const DASHBOARD_TIMEZONE = DEFAULT_TIMEZONE;

/** The windows the widgets offer; the nightly job builds a snapshot of each. */
export const DASHBOARD_RANGES = [7, 14, 30] as const;

/** `YYYY-MM-DD` of `now` in `timeZone`. */
export function dashboardDay(now: Date, timeZone: string = DASHBOARD_TIMEZONE): string {
  // `en-CA` formats as ISO.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const shiftDay = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The window behind "Last N Days": N days back to today, both ends included —
 * "Last 14 Days" is fifteen bar groups, as in Workiz.
 */
export function dashboardWindow(
  days: number,
  now: Date,
  timeZone: string = DASHBOARD_TIMEZONE,
): { from: string; to: string } {
  const to = dashboardDay(now, timeZone);
  return { from: shiftDay(to, -days), to };
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms (negative west of Greenwich). */
function offsetAt(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant the wall clock in `timeZone` reads `hour`:00 on `day`. */
function wallClock(day: string, hour: number, timeZone: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, hour);
  // Twice: the first guess can sit on the other side of a clock change.
  const first = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(first, timeZone);
}

/**
 * Milliseconds from `now` to the next `hour`:00 in `timeZone` — strictly
 * after `now`, and right across the spring and autumn clock changes.
 */
export function msUntilDailyAt(now: Date, hour: number, timeZone: string = DASHBOARD_TIMEZONE): number {
  const today = dashboardDay(now, timeZone);
  let next = wallClock(today, hour, timeZone);
  if (next <= now.getTime()) next = wallClock(shiftDay(today, 1), hour, timeZone);
  return next - now.getTime();
}
