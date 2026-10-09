import { REPORT_TIMEZONE, wallClock } from './report/report-dates';

/**
 * Workiz "Update Job End Time" (Account → Preferences): a job marked Done or
 * Canceled ends at that moment. Workiz's export shows the rule applied
 * literally — the end becomes the second the status changed, however far
 * from the planned visit (weeks after it, or even before it: 271 of 367k
 * closed jobs end before they start) — and the start never moves.
 *
 * A BitCRM visit is a wall-clock day and slot in the job's zone, plus, on an
 * imported job, the instants Workiz held (`jobDateUtc` / `jobEndDateUtc` with
 * `jobTimezone`). The patch moves all of the end: the end day and the slot's
 * end on the job's clock, and `jobEndDateUtc` with the zone it was read on —
 * `jobEndAt` (the EndIndex, the "Job end date" reports) prefers that instant
 * while its day matches the end day, so the report lands on the exact
 * account-clock moment, whatever zone the job is in.
 */
export interface CloseEndSource {
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  allDay?: boolean;
  /** The zone an imported job was booked in; wins over the area's. */
  jobTimezone?: string;
}

export interface CloseEndPatch {
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  jobEndDateUtc: string;
  /** Written only when the job had no zone of its own: the one the end was read on. */
  jobTimezone?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The slot's start when it is a real `HH:MM`. */
function slotStart(slot: string | undefined): string | undefined {
  const t = slot?.slice(0, 5);
  return t && HHMM.test(t) ? t : undefined;
}

/**
 * Where a job closed at `closedAt` (ISO instant) now ends. The end day is
 * always the close day on the job's clock — that is the day Workiz's reports
 * list it on. The time is the close time, except on the start day itself
 * when the close came before the start: a slot cannot run backwards, so the
 * end is held at the start (the day is still right). An unscheduled job is
 * not scheduled by closing it: only the end instant is written, and the
 * reports read that.
 */
export function closeEndPatch(deal: CloseEndSource, closedAt: string, areaTimezone?: string): CloseEndPatch {
  const tz = deal.jobTimezone || areaTimezone || REPORT_TIMEZONE;
  const patch: CloseEndPatch = { jobEndDateUtc: closedAt, ...(deal.jobTimezone ? {} : { jobTimezone: tz }) };
  const wall = wallClock(closedAt, tz);
  if (!wall || !deal.scheduledDate) return patch;

  const day = wall.slice(0, 10);
  patch.scheduledEndDate = day;
  const start = slotStart(deal.scheduledTimeSlot);
  if (deal.allDay || !start) return patch;

  let end = wall.slice(11, 16);
  if (day === deal.scheduledDate && end < start) end = start;
  patch.scheduledTimeSlot = `${start}-${end}`;
  return patch;
}

/** Whether `row` already carries every value of `patch` — a second pass has nothing to write. */
export function closeEndApplied(row: Record<string, unknown>, patch: CloseEndPatch): boolean {
  return Object.entries(patch).every(([key, value]) => row[key] === value);
}
