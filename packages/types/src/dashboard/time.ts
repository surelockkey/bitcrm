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

/**
 * Workiz Home's range picker, in its order: "This week (Mon-Today)", "Last 14
 * days", "This month", "Last 3 months" (Workiz's main.js, the dashboard's
 * `timeRangeOptions`). Every widget with a picker offers these and opens on
 * the 14 days; the nightly job builds a snapshot of each.
 */
export const DASHBOARD_PRESETS = ['this_week', 'last_14_days', 'this_month', 'last_three'] as const;

export type DashboardPreset = (typeof DASHBOARD_PRESETS)[number];

/**
 * The days behind a preset, on the account's calendar, both ends included:
 * this week is Monday..today; the 14 days are the chart Workiz draws (fifteen
 * days, as `dashboardWindow(14)`); this month is the 1st..today; the last 3
 * months are the three whole months before this one, as Workiz's own picker
 * defines them — at most 92 days, the server's ceiling.
 */
export function dashboardPresetWindow(
  preset: DashboardPreset,
  now: Date,
  timeZone: string = DASHBOARD_TIMEZONE,
): { from: string; to: string } {
  const today = dashboardDay(now, timeZone);
  switch (preset) {
    case 'this_week': {
      // getUTCDay of the calendar day: 0 is Sunday, which closes the Monday week.
      const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
      return { from: shiftDay(today, -((weekday + 6) % 7)), to: today };
    }
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last_three': {
      const firstOfThis = `${today.slice(0, 7)}-01`;
      const d = new Date(`${firstOfThis}T00:00:00.000Z`);
      d.setUTCMonth(d.getUTCMonth() - 3);
      return { from: d.toISOString().slice(0, 10), to: shiftDay(firstOfThis, -1) };
    }
    default:
      return dashboardWindow(14, now, timeZone);
  }
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
