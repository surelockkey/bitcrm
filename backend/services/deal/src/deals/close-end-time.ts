import { REPORT_TIMEZONE, wallClock } from './report/report-dates';

/**
 * Workiz "Update Job End Time" (Account → Preferences): a job marked Done or
 * Canceled ends at that moment. Workiz's export shows the rule applied
 * literally — the end becomes the second the status changed, however far
 * after the planned visit (weeks later) — and the start never moves. Workiz
 * also applied it to jobs closed before they began (271 of 367k closed jobs
 * end before they start); BitCRM does not: a visit that has not begun yet
 * keeps its schedule, and the end never lands before the start.
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
  /** Absent — with everything else — when the visit had not begun at the close. */
  jobEndDateUtc?: string;
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
 * Where a job closed at `closedAt` (ISO instant) now ends. Once the visit has
 * begun, the end day is the close day on the job's clock — that is the day
 * Workiz's reports list it on — and the time is the close time. A job closed
 * before its visit began (tomorrow's job marked Done today, this morning's
 * before its slot) is left exactly as scheduled: nothing of the end is
 * written, the reports keep reading the planned end, and `closedAt` (the
 * caller's) says when it was closed. An unscheduled job is not scheduled by
 * closing it: only the end instant is written, and the reports read that.
 */
export function closeEndPatch(deal: CloseEndSource, closedAt: string, areaTimezone?: string): CloseEndPatch {
  const tz = deal.jobTimezone || areaTimezone || REPORT_TIMEZONE;
  const wall = wallClock(closedAt, tz);
  if (wall && closedBeforeStart(deal, wall)) return {};

  const patch: CloseEndPatch = { jobEndDateUtc: closedAt, ...(deal.jobTimezone ? {} : { jobTimezone: tz }) };
  if (!wall || !deal.scheduledDate) return patch;

  patch.scheduledEndDate = wall.slice(0, 10);
  const start = slotStart(deal.scheduledTimeSlot);
  if (deal.allDay || !start) return patch;

  patch.scheduledTimeSlot = `${start}-${wall.slice(11, 16)}`;
  return patch;
}

/**
 * Whether the close (`wall`, `YYYY-MM-DDTHH:MM` on the job's clock) came
 * before the visit's start: before the slot's start on the start day, or on
 * an earlier day. A visit without times begins with its day.
 */
function closedBeforeStart(deal: CloseEndSource, wall: string): boolean {
  if (!deal.scheduledDate) return false;
  const start = deal.allDay ? undefined : slotStart(deal.scheduledTimeSlot);
  return start ? wall < `${deal.scheduledDate}T${start}` : wall.slice(0, 10) < deal.scheduledDate;
}

/** Whether `row` already carries every value of `patch` — a second pass has nothing to write. */
export function closeEndApplied(row: Record<string, unknown>, patch: CloseEndPatch): boolean {
  return Object.entries(patch).every(([key, value]) => row[key] === value);
}
