import {
  DealStatus,
  JobSuperStatus,
  isClientConfirmationCurrent,
  type ClientConfirmState,
  type Deal,
} from '@bitcrm/types';
import { shiftDay, wallClock } from '../report/report-dates';

/**
 * When the client may confirm their visit (B12, Workiz `{{confirm_link}}`).
 * Pure — the service feeds it the job, the clock and the job's zone.
 */

/** Nothing left to confirm: the work is finished, called off, or the job is gone. */
const CLOSED = new Set<string>([JobSuperStatus.DONE, JobSuperStatus.CANCELED, JobSuperStatus.DONE_PENDING_APPROVAL]);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The end of the visit on the job's own clock, `YYYY-MM-DDTHH:MM`: the end
 * day (else the start day) at the slot's end; the end of that day for an
 * all-day visit or one with no time; the next day when a same-day slot ends
 * before it starts (22:00-01:00). No date, no end.
 */
export function visitEndWall(
  d: Pick<Deal, 'scheduledDate' | 'scheduledEndDate' | 'scheduledTimeSlot' | 'allDay'>,
): string | undefined {
  if (!d.scheduledDate) return undefined;
  let day = d.scheduledEndDate || d.scheduledDate;
  const start = d.scheduledTimeSlot?.slice(0, 5);
  const end = d.scheduledTimeSlot?.slice(6, 11);
  if (d.allDay || !end || !HHMM.test(end)) return `${day}T23:59`;
  if (day === d.scheduledDate && start && HHMM.test(start) && end < start) day = shiftDay(day, 1);
  return `${day}T${end}`;
}

/**
 * closed > confirmed > expired > open: a closed job says so whatever was
 * confirmed before; a confirmation of THIS visit stays the answer after the
 * visit; a visit that is over can no longer be confirmed; anything else can
 * — an undated job too (Workiz flags the job, not a time).
 */
export function clientConfirmState(
  deal: Pick<
    Deal,
    | 'status'
    | 'superStatus'
    | 'scheduledDate'
    | 'scheduledEndDate'
    | 'scheduledTimeSlot'
    | 'allDay'
    | 'clientConfirmedAt'
    | 'clientConfirmedFor'
  >,
  now: Date,
  timezone: string,
): ClientConfirmState {
  if (deal.status !== DealStatus.ACTIVE || CLOSED.has(deal.superStatus)) return 'closed';
  if (isClientConfirmationCurrent(deal)) return 'confirmed';
  const end = visitEndWall(deal);
  const nowWall = wallClock(now.toISOString(), timezone);
  if (end && nowWall && nowWall > end) return 'expired';
  return 'open';
}
