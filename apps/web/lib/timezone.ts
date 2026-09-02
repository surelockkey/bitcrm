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
 * A sensible default schedule for "now" in a zone: today's date, the current
 * time floored to a quarter hour as the start, and an hour later as the end
 * (clamped to 23:45). Used to prefill the New Job schedule.
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
  const [h, m] = hm.split(":").map(Number);
  const rm = Math.floor(m / 15) * 15;
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
