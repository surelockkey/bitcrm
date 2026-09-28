import { dashboardDay, dashboardWindow, type JobsByStatusDay } from "@bitcrm/types";

/**
 * The windows the "Jobs By Status" card offers.
 *
 * Deliberately its own short list rather than `DASHBOARD_PERIODS` in `lib.ts`:
 * the card carries its own picker (as Workiz's does), and Workiz's wording
 * counts days back, not calendar periods. Worth unifying the day someone
 * gives every widget the page's period instead.
 */
export const RANGE_PRESETS = [
  { days: 7, label: "Last 7 Days" },
  { days: 14, label: "Last 14 Days" },
  { days: 30, label: "Last 30 Days" },
] as const;

export type DashboardRange = (typeof RANGE_PRESETS)[number]["days"];

/** Every windowed widget opens on the last thirty days. */
export const DEFAULT_RANGE: DashboardRange = 30;

/**
 * `YYYY-MM-DD` on the account's calendar — Eastern, where the business is.
 * Not the viewer's zone: the nightly snapshots are built on that calendar,
 * and a window named in another zone would miss them.
 */
export function localDay(at: Date): string {
  return dashboardDay(at);
}

/**
 * The window behind a "Last N Days" label.
 *
 * N is how far back it reaches, and **both ends are included** — so "Last 14
 * Days" draws fifteen bar groups, Sep 14th through Sep 28th. That is what
 * Workiz does; it reads as "back to a fortnight ago", today included, and is
 * not an off-by-one. The same function builds the server's snapshots.
 */
export function rangeWindow(days: number, now: Date = new Date()): { from: string; to: string } {
  return dashboardWindow(days, now);
}

/** How many of each state across the window. */
export function seriesTotals(days: JobsByStatusDay[]): {
  open: number;
  done: number;
  canceled: number;
} {
  return days.reduce(
    (sum, d) => ({
      open: sum.open + d.open,
      done: sum.done + d.done,
      canceled: sum.canceled + d.canceled,
    }),
    { open: 0, done: 0, canceled: 0 },
  );
}

/** `2026-09-14` → `Sep 14th`, the axis label Workiz writes. */
export function axisDayLabel(day: string): string {
  const at = new Date(`${day}T12:00:00.000Z`);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(at);
  const n = at.getUTCDate();
  return `${month} ${n}${ordinal(n)}`;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/** `updated 3:08 AM` — when the card last had an answer from the server. */
export function updatedAtLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at);
}
