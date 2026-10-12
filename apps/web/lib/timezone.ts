/**
 * Timezone helpers. The business runs on Connecticut time (Eastern); a job is
 * shown in its service area's timezone when it has one, otherwise the default.
 * Everything renders an absolute instant (ISO/UTC) in a chosen IANA zone via
 * Intl, so it's correct regardless of the viewer's own clock.
 */

/** Connecticut / Eastern — the business default everywhere. */
export const DEFAULT_TZ = "America/New_York";

/** The US zones offered in the service-area timezone picker. */
export const US_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain — no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

/** Plain-words label for a zone; falls back to the raw id. */
export function tzLabel(tz: string): string {
  return US_TIMEZONES.find((t) => t.value === tz)?.label ?? tz;
}

/** Wall-clock time (e.g. "8:02 AM") of an instant in a zone. */
export function clockInTz(iso: string, tz: string = DEFAULT_TZ): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A sensible default schedule for "now" in a zone, as Workiz's New Job sets
 * it: today's date, the current time rounded up to the next quarter hour as
 * the start ("It's 7:53 AM" → 08:00 AM), and an hour later as the end — both
 * clamped to 23:45, so a late job stays on today.
 */
export function nowScheduleDefault(
  tz: string = DEFAULT_TZ,
  now: Date = new Date(),
): { date: string; start: string; end: string } {
  // en-CA renders YYYY-MM-DD; en-GB renders 24h HH:MM — both honoring the zone.
  const date = now.toLocaleDateString("en-CA", { timeZone: tz });
  const hm = now.toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [hh, mm] = hm.split(":").map(Number);
  let h = hh;
  let rm = Math.ceil(mm / 15) * 15;
  if (rm === 60) {
    h += 1;
    rm = 0;
  }
  if (h > 23) {
    h = 23;
    rm = 45;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${pad(h)}:${pad(rm)}`;
  let eh = h + 1;
  let em = rm;
  if (eh > 23) {
    eh = 23;
    em = 45;
  }
  return { date, start, end: `${pad(eh)}:${pad(em)}` };
}

/** Date + time (e.g. "Aug 19, 12:00 PM") of an instant in a zone. */
export function formatInstant(iso: string, tz: string = DEFAULT_TZ): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** How far `zone` is ahead of UTC at `instant`, in ms. */
export function offsetAt(instant: number, zone: string): number {
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

/** The wall clock ("YYYY-MM-DD", "HH:MM") an instant reads in `zone`. */
function wallOf(instant: Date, zone: string): { date: string; time: string } {
  const wall = new Date(instant.getTime() + offsetAt(instant.getTime(), zone));
  return {
    date: `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`,
    time: `${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`,
  };
}

function toDate(at: Date | string | number | undefined | null): Date | null {
  if (at === undefined || at === null || at === "") return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The zone's short name at an instant — "EDT" in summer, "EST" in winter
 * (CDT, MST…); "" when the instant is unreadable. 2026-10-12: the web prints
 * it after every time, because an unlabelled "09:34 am" was read in the wrong
 * zone.
 */
export function zoneAbbr(at: Date | string | number | undefined | null, tz: string = DEFAULT_TZ): string {
  const d = toDate(at);
  if (!d) return "";
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  );
}

/** `text` followed by the zone's label at `at` ("… 09:34 am EDT"); an empty text stays empty. */
export function withZone(text: string, at: Date | string | number | undefined | null, tz: string = DEFAULT_TZ): string {
  if (!text) return text;
  const abbr = zoneAbbr(at, tz);
  return abbr ? `${text} ${abbr}` : text;
}

/**
 * A visit's stored wall clock — the date and HH:MM it was booked at in its own
 * zone (`jobTimezone`, else its area's; absent = Connecticut) — on
 * Connecticut's clock, the web's. A Texas 10:00 is 11:00 EDT, and a late
 * Arizona visit can land on Connecticut's next day.
 */
export function wallToCt(
  date: string,
  time: string,
  fromTz: string | undefined,
): { date: string; time: string; abbr: string; instant: Date } {
  const instant = zonedInstant(date, time, fromTz || DEFAULT_TZ);
  return { ...wallOf(instant, DEFAULT_TZ), abbr: zoneAbbr(instant), instant };
}

/** Back the other way: a Connecticut wall clock (a drop on the schedule) in the job's own zone. */
export function ctToZoneWall(date: string, time: string, toTz: string | undefined): { date: string; time: string } {
  return wallOf(zonedInstant(date, time, DEFAULT_TZ), toTz || DEFAULT_TZ);
}

/** Today ("YYYY-MM-DD") on Connecticut's calendar — never the browser's. */
export function ctToday(now: Date = new Date()): string {
  return wallOf(now, DEFAULT_TZ).date;
}

/** Minutes since Connecticut's midnight — where a "now" line sits on a CT grid. */
export function ctMinutesOfDay(now: Date = new Date()): number {
  const [h, m] = wallOf(now, DEFAULT_TZ).time.split(":").map(Number);
  return h * 60 + m;
}

