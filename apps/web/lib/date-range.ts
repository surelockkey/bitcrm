/**
 * Local-time helpers behind the custom date+time range calendar.
 *
 * The picker works in the user's local timezone (that's what a "9 AM – 5 PM"
 * filter means to them); the range it emits is a pair of absolute UTC ISO
 * instants, which is what the APIs compare against stored timestamps.
 * No date library — the app has none, and these are the only bits we need.
 */

/** An absolute range: UTC ISO instants, either side optional. */
export interface DateTimeRange {
  from?: string;
  to?: string;
}

/** A range as the calendar edits it: local day + local `HH:mm`. */
export interface LocalParts {
  date: string;
  time: string;
}

export const DAY_START = "00:00";
export const DAY_END = "23:59";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export { WEEKDAYS, MONTHS };

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date → its local day key, `YYYY-MM-DD` (never UTC — see file header). */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` (+ optional `HH:mm`) → a local Date. */
export function parseDateKey(key: string, time = DAY_START): Date {
  const [y, m, d] = key.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h || 0, min || 0, 0, 0);
}

/** Local day + `HH:mm` → the absolute instant, as a UTC ISO string. */
export function toIsoInstant(dateKey: string, time: string): string {
  return parseDateKey(dateKey, time).toISOString();
}

/** UTC ISO instant → the local day/time the calendar shows for it. */
export function toLocalParts(iso?: string): LocalParts | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return { date: toDateKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Quarter-hour options for the time selects, `00:00` → `23:45`, plus `23:59`. */
export const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) out.push(`${pad(h)}:${pad(m)}`);
  }
  out.push(DAY_END); // end-of-day bound, so "to = today" covers the whole day
  return out;
})();

/** `14:30` → `2:30 PM`. */
export function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

/**
 * Whatever someone types into a time box → canonical `HH:mm`, or undefined
 * when it isn't a time. Deliberately forgiving: `9`, `930`, `9:30`, `9:3`,
 * `9pm`, `9:30 PM`, `21:30` and `2130` all land where you'd expect.
 */
export function parseTimeInput(raw: string): string | undefined {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  const m = /^(\d{1,2})(?::(\d{1,2})|(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return undefined;

  let hours = Number(m[1]);
  const minutes = Number(m[2] ?? m[3] ?? 0);
  const meridiem = m[4]?.[0];
  if (minutes > 59) return undefined;

  if (meridiem) {
    // 12-hour input: only 1–12 is meaningful next to an am/pm.
    if (hours < 1 || hours > 12) return undefined;
    if (meridiem === "a") hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return undefined;
  }

  return `${pad(hours)}:${pad(minutes)}`;
}

/** `Aug 5` — with the year when it isn't the current one. */
export function formatDayLabel(dateKey: string, now = new Date()): string {
  const d = parseDateKey(dateKey);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * The trigger's summary of the range. Whole-day bounds hide their times —
 * "Aug 5 – Aug 8" reads better than "Aug 5, 12:00 AM – Aug 8, 11:59 PM".
 */
export function formatRangeLabel(range: DateTimeRange, now = new Date()): string {
  const from = toLocalParts(range.from);
  const to = toLocalParts(range.to);
  if (!from && !to) return "Any date";

  const wholeDays =
    (!from || from.time === DAY_START) && (!to || to.time === DAY_END);
  const part = (p: LocalParts) =>
    wholeDays
      ? formatDayLabel(p.date, now)
      : `${formatDayLabel(p.date, now)}, ${formatTime12(p.time)}`;

  if (from && to) {
    if (from.date === to.date && !wholeDays) {
      return `${formatDayLabel(from.date, now)} · ${formatTime12(from.time)} – ${formatTime12(to.time)}`;
    }
    return `${part(from)} – ${part(to)}`;
  }
  return from ? `From ${part(from)}` : `Until ${part(to!)}`;
}

/** Month grid cells: leading/trailing blanks pad the weeks out to full rows. */
export function monthCells(view: Date): (Date | null)[] {
  const year = view.getFullYear();
  const month = view.getMonth();
  const startPad = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const out: (Date | null)[] = Array.from({ length: startPad }, () => null);
  for (let d = 1; d <= days; d++) out.push(new Date(year, month, d));
  while (out.length % 7 !== 0) out.push(null);
  return out;
}

/** First of the month, `n` months from `d`. */
export function shiftMonth(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export type RangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "thisYear";

export const PRESET_LABEL: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  thisMonth: "This month",
  lastMonth: "Last month",
  thisYear: "This year",
};

/** A preset as an absolute range — whole days, in local time. */
export function presetRange(preset: RangePreset, now = new Date()): DateTimeRange {
  const today = toDateKey(now);
  const daysAgo = (n: number) =>
    toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

  switch (preset) {
    case "today":
      return { from: toIsoInstant(today, DAY_START), to: toIsoInstant(today, DAY_END) };
    case "yesterday": {
      const y = daysAgo(1);
      return { from: toIsoInstant(y, DAY_START), to: toIsoInstant(y, DAY_END) };
    }
    case "last7":
      return {
        from: toIsoInstant(daysAgo(6), DAY_START),
        to: toIsoInstant(today, DAY_END),
      };
    case "last30":
      return {
        from: toIsoInstant(daysAgo(29), DAY_START),
        to: toIsoInstant(today, DAY_END),
      };
    case "thisMonth":
      return {
        from: toIsoInstant(toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), DAY_START),
        to: toIsoInstant(today, DAY_END),
      };
    case "lastMonth":
      return {
        from: toIsoInstant(toDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), DAY_START),
        // Day 0 of this month = the last day of the previous one.
        to: toIsoInstant(toDateKey(new Date(now.getFullYear(), now.getMonth(), 0)), DAY_END),
      };
    case "thisYear":
      return {
        from: toIsoInstant(toDateKey(new Date(now.getFullYear(), 0, 1)), DAY_START),
        to: toIsoInstant(today, DAY_END),
      };
  }
}
