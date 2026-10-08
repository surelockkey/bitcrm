/**
 * Workiz's Scheduled cell (list_01_submitted, 5TU7ZA):
 *
 *   Thu Oct 08, 2026 09:00 am      ← the visit on the account's clock
 *   Princeton:                     ← only when the job's own zone differs
 *   Thu Oct 08, 2026 08:00 am      ← the visit on the job's own clock
 *   in 26 minutes                  ← moment.js fromNow(); red once it has passed
 *
 * A visit's date and slot are stored as the wall clock of the zone they were
 * booked in — the job's own (`jobTimezone`, from Workiz) or its service
 * area's — so the account line is a conversion and the area line is the
 * stored time as it is.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** How far `zone` is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - instant;
}

/** The instant a wall clock in `zone` reads `date` `time` (HH:MM). */
export function zonedInstant(date: string, time: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, h, min);
  // Twice: the first guess can sit on the other side of a DST change.
  const first = naive - offsetAt(naive, zone);
  return new Date(naive - offsetAt(first, zone));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu Oct 08, 2026" for a calendar date. */
function workizDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${MONTHS[m - 1]} ${pad(d)}, ${y}`;
}

/** "Thu Oct 08, 2026 09:00 am" — an instant on `zone`'s clock. */
function workizStamp(instant: Date, zone: string): string {
  const off = offsetAt(instant.getTime(), zone);
  const wall = new Date(instant.getTime() + off);
  const date = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  const h = wall.getUTCHours();
  return `${workizDay(date)} ${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(wall.getUTCMinutes())} ${h < 12 ? "am" : "pm"}`;
}

/** moment.js `fromNow()` with its default thresholds — the words Workiz prints. */
export function workizFromNow(at: Date, now: Date = new Date()): string {
  const ms = at.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const seconds = Math.round(abs / 1000);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const months = Math.round(((abs / 86_400_000) * 4800) / 146097);
  const years = Math.round(abs / 86_400_000 / 365.2425);
  const phrase =
    seconds < 45
      ? "a few seconds"
      : minutes <= 1
        ? "a minute"
        : minutes < 45
          ? `${minutes} minutes`
          : hours <= 1
            ? "an hour"
            : hours < 22
              ? `${hours} hours`
              : days <= 1
                ? "a day"
                : days < 26
                  ? `${days} days`
                  : months <= 1
                    ? "a month"
                    : months < 11
                      ? `${months} months`
                      : years <= 1
                        ? "a year"
                        : `${years} years`;
  return ms >= 0 ? `in ${phrase}` : `${phrase} ago`;
}

export interface ScheduleCellInput {
  scheduledDate?: string;
  /** "HH:MM-HH:MM"; absent for an all-day visit. */
  scheduledTimeSlot?: string;
  /** The place the area line is labelled with — the job's city. */
  city?: string;
  /** The zone the visit was booked in; absent = the account's. */
  zone?: string;
}

export interface ScheduleCell {
  when: string;
  area: { place: string; when: string } | null;
  relative: string | null;
  past: boolean;
}

export function workizScheduleCell(
  input: ScheduleCellInput,
  accountZone: string,
  now: Date = new Date(),
): ScheduleCell {
  const date = input.scheduledDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { when: "Unscheduled", area: null, relative: null, past: false };
  const zone = input.zone || accountZone;
  const start = input.scheduledTimeSlot?.split("-")[0]?.trim();
  const timed = !!start && /^\d{2}:\d{2}$/.test(start);
  const instant = zonedInstant(date, timed ? start! : "00:00", zone);
  const past = instant.getTime() < now.getTime();
  const relative = workizFromNow(instant, now);
  if (!timed) return { when: workizDay(date), area: null, relative, past };

  const when = workizStamp(instant, accountZone);
  const own = workizStamp(instant, zone);
  const area = own !== when ? { place: input.city || "", when: own } : null;
  return { when, area, relative, past };
}
