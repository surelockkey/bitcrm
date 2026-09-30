import { DASHBOARD_TIMEZONE } from '@bitcrm/types';

/**
 * The dates a job is reported on, in the account's calendar.
 *
 * Workiz reports every job on the account's clock — America/New_York for
 * SLK — whatever zone the visit happened in: a Dallas job at 23:30 local is
 * on the next day's row, because the report prints it as 00:30 Eastern. The
 * Jobs report and Job Statistics both window on these days.
 *
 * BitCRM keeps a visit as a wall-clock date and slot in the job's own zone
 * (`scheduledDate` + `scheduledTimeSlot`). A job imported from Workiz also
 * carries the instants Workiz held (`jobDateUtc`, `jobEndDateUtc`, with
 * `jobTimezone`), and those are what the Workiz report used. They are
 * trusted only while they still describe the visit BitCRM has on the job —
 * their local day equals `scheduledDate` / `scheduledEndDate` — so a job
 * rescheduled here reports on its new date, not on the stale import.
 */
export const REPORT_TIMEZONE = DASHBOARD_TIMEZONE;

/** What a job's report dates are computed from — a deal row or any part of it. */
export interface ReportDateSource {
  createdAt?: string;
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  allDay?: boolean;
  jobDateUtc?: string;
  jobEndDateUtc?: string;
  jobTimezone?: string;
}

export type ReportDateField = 'created' | 'scheduled' | 'end';

const QUARTER_HOUR = 15 * 60_000;
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat | null>();
/**
 * Zone offsets memoised per quarter hour: every zone changes its offset on a
 * quarter-hour boundary of UTC, so the cache is exact — and a year of report
 * rows asks `Intl` a few thousand times instead of a few hundred thousand.
 */
const offsets = new Map<string, number>();
const OFFSETS_MAX = 200_000;

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      // An unknown zone name on an imported row reads as the account's own.
      f = null;
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/** How far `timeZone` is ahead of UTC at `ms`, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  const bucket = Math.floor(ms / QUARTER_HOUR);
  const key = `${timeZone}|${bucket}`;
  const hit = offsets.get(key);
  if (hit !== undefined) return hit;
  const f = formatter(timeZone) ?? formatter(REPORT_TIMEZONE)!;
  const at = bucket * QUARTER_HOUR;
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  const offset = asUtc - at;
  if (offsets.size >= OFFSETS_MAX) offsets.clear();
  offsets.set(key, offset);
  return offset;
}

/**
 * `YYYY-MM-DDTHH:MM` — what a wall clock in `timeZone` shows at `instant`.
 * Undefined for a missing or unparseable instant.
 */
export function wallClock(instant: string | undefined, timeZone: string = REPORT_TIMEZONE): string | undefined {
  if (!instant) return undefined;
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + offsetAt(ms, timeZone || REPORT_TIMEZONE)).toISOString().slice(0, 16);
}

/** `YYYY-MM-DD` of `instant` in `timeZone`. */
export function dayOf(instant: string | undefined, timeZone: string = REPORT_TIMEZONE): string | undefined {
  return wallClock(instant, timeZone)?.slice(0, 10);
}

/** The instant (ISO, ms precision) the day `day` begins in `timeZone`. */
export function dayStartUtc(day: string, timeZone: string = REPORT_TIMEZONE): string {
  const naive = Date.parse(`${day}T00:00:00.000Z`);
  // Twice: the first guess can sit on the other side of a clock change.
  const first = naive - offsetAt(naive, timeZone);
  return new Date(naive - offsetAt(first, timeZone)).toISOString();
}

/** `day` moved by `days` calendar days. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A slot's start (`slice(0, 5)`) or end (`slice(6, 11)`), when it is a real `HH:MM`. */
function slotPart(slot: string | undefined, part: 'start' | 'end'): string | undefined {
  if (!slot) return undefined;
  const t = part === 'start' ? slot.slice(0, 5) : slot.slice(6, 11);
  return HHMM.test(t) ? t : undefined;
}

/** An imported instant still describes the visit when its own local day is the job's day. */
function stillTheVisit(instant: string, jobTimezone: string | undefined, day: string | undefined): boolean {
  if (!day) return true;
  return dayOf(instant, jobTimezone || REPORT_TIMEZONE) === day;
}

/** When the job was created, on the account's clock. */
export function createdAt(d: ReportDateSource): string | undefined {
  return wallClock(d.createdAt);
}

/**
 * The visit's start on the account's clock — `YYYY-MM-DDTHH:MM`, or a bare
 * `YYYY-MM-DD` for an all-day visit. A job with no date at all reports on
 * its creation: Workiz gives every unscheduled job a hidden one-hour slot
 * from the moment it was created, "only for reporting purposes".
 */
export function jobStartAt(d: ReportDateSource): string | undefined {
  if (d.jobDateUtc && stillTheVisit(d.jobDateUtc, d.jobTimezone, d.scheduledDate)) {
    const at = wallClock(d.jobDateUtc);
    if (at) return at;
  }
  if (d.scheduledDate) {
    const t = d.allDay ? undefined : slotPart(d.scheduledTimeSlot, 'start');
    return t ? `${d.scheduledDate}T${t}` : d.scheduledDate;
  }
  return createdAt(d);
}

/**
 * The visit's end on the account's clock — Workiz's "Job end date", the
 * date its report and Job Statistics call "Closed". An undated job ends an
 * hour after it was created (the hidden slot, see `jobStartAt`).
 */
export function jobEndAt(d: ReportDateSource): string | undefined {
  const endDay = d.scheduledEndDate || d.scheduledDate;
  if (d.jobEndDateUtc && stillTheVisit(d.jobEndDateUtc, d.jobTimezone, endDay)) {
    const at = wallClock(d.jobEndDateUtc);
    if (at) return at;
  }
  if (endDay) {
    const t = d.allDay ? undefined : slotPart(d.scheduledTimeSlot, 'end');
    return t ? `${endDay}T${t}` : endDay;
  }
  const created = d.createdAt ? Date.parse(d.createdAt) : NaN;
  return Number.isNaN(created) ? undefined : wallClock(new Date(created + 3_600_000).toISOString());
}

/** The moment a job is reported on for a "By:" choice. */
export function reportAt(d: ReportDateSource, by: ReportDateField): string | undefined {
  if (by === 'created') return createdAt(d);
  if (by === 'scheduled') return jobStartAt(d);
  return jobEndAt(d);
}

/** The account-calendar day a job is reported on for a "By:" choice. */
export function reportDay(d: ReportDateSource, by: ReportDateField): string | undefined {
  return reportAt(d, by)?.slice(0, 10);
}
