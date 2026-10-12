import type { ClientConfirmVisit } from "@bitcrm/types";

/**
 * The visit as the confirm page prints it. The job keeps the visit as a
 * wall-clock day (`YYYY-MM-DD`) and slot (`HH:MM-HH:MM`) in the job's own
 * zone — the clock the client lives on — so both are printed exactly as
 * stored: the day is read as a calendar date (UTC midnight, formatted in
 * UTC) and the times as plain hours, never shifted through the phone's zone.
 */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

function clock(hhmm: string): string | null {
  const m = HHMM.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export function formatVisit(visit: ClientConfirmVisit): { day: string; time?: string } {
  const start = visit.scheduledDate ? calendarDay(visit.scheduledDate) : null;
  if (!start) return { day: "Date to be confirmed" };
  const end = visit.scheduledEndDate && visit.scheduledEndDate !== visit.scheduledDate ? calendarDay(visit.scheduledEndDate) : null;
  const day = end ? `${dayText(start, false)} – ${dayText(end, true)}` : dayText(start, true);

  if (visit.allDay) return { day, time: "All day" };
  const [from, to] = (visit.scheduledTimeSlot ?? "").split("-");
  const a = from ? clock(from.trim()) : null;
  const b = to ? clock(to.trim()) : null;
  if (!a) return { day };
  return { day, time: b && b !== a ? `${a} – ${b}` : a };
}

/** "Oct 12, 3:05 PM" — when the client confirmed, on the job's clock. */
export function formatConfirmedAt(iso: string | undefined, timezone: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = timezone ? { timeZone: timezone } : {};
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...tz });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...tz });
  return `${date}, ${time}`;
}
