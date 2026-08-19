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
