import { formatVisitTimes } from "@bitcrm/portal-ui";
import { DEFAULT_TIMEZONE, zoneAbbr, type ClientConfirmVisit } from "@bitcrm/types";

/**
 * The visit as the confirm page prints it. The job keeps the visit as a
 * wall-clock day (`YYYY-MM-DD`) and slot (`HH:MM-HH:MM`) in the job's own
 * zone — the clock the client lives on — so both are printed exactly as
 * stored: the day is read as a calendar date (UTC midnight, formatted in
 * UTC) and the times as plain hours, never shifted through the phone's zone.
 * The time names the job's zone for that day ("9:00 AM – 11:00 AM CDT";
 * owner, 2026-10-12), New York when the page was sent none.
 */

function calendarDay(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dayText = (d: Date, withYear: boolean) =>
  d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(withYear && { year: "numeric" }),
    timeZone: "UTC",
  });

export function formatVisit(visit: ClientConfirmVisit): { day: string; time?: string } {
  const start = visit.scheduledDate ? calendarDay(visit.scheduledDate) : null;
  if (!start) return { day: "Date to be confirmed" };
  const end = visit.scheduledEndDate && visit.scheduledEndDate !== visit.scheduledDate ? calendarDay(visit.scheduledEndDate) : null;
  const day = end ? `${dayText(start, false)} – ${dayText(end, true)}` : dayText(start, true);

  if (visit.allDay) return { day, time: "All day" };
  const time = formatVisitTimes(visit);
  return time ? { day, time } : { day };
}

/** "Oct 12, 3:05 PM EDT" — when the client confirmed, on the job's clock (New York when unknown). */
export function formatConfirmedAt(iso: string | undefined, timezone: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let timeZone = timezone || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    timeZone = DEFAULT_TIMEZONE;
  }
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }).replace(/\u202f/g, " ");
  const abbr = zoneAbbr(d, timeZone);
  return `${date}, ${time}${abbr ? ` ${abbr}` : ""}`;
}
