import type { RescheduleDealBody } from './api';
import { formatDayHeading, formatSlot } from './lib';

/**
 * Moving a visit from the phone.
 *
 * 15 956 of this account's reschedules were done from the Workiz app
 * (`docs/import/WORKIZ_MOBILE_APP.md` §1.3) — a technician who finds nobody
 * home, or a job that turns into a two-day one, books the next slot standing
 * where they are. Everything that decides *which* slots exist and whether a
 * move is allowed is here, as pure functions, because the one mistake this
 * screen must not make is putting a visit in the past: a job dated yesterday
 * drops off the day list into "still open from earlier", where it looks like
 * work somebody forgot.
 */

/** "HH:MM-HH:MM" → minutes since midnight. Null for anything else. */
export function parseSlot(slot: string | undefined): { start: number; end: number } | null {
  if (!slot) return null;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(slot.trim());
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return { start, end };
}

/** Minutes since the device's local midnight — "how far into today is it". */
export function minutesOfDay(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * The arrival windows on offer.
 *
 * Two-hour windows across a working day, which is what this account's jobs are
 * actually booked in, and what a client is told to expect. A technician is
 * never asked to type a time: a keypad in a van is how "10:00-12:00" becomes
 * "1000-1200" and the server answers 400.
 */
export const SLOT_CHOICES = [
  '08:00-10:00',
  '10:00-12:00',
  '12:00-14:00',
  '14:00-16:00',
  '16:00-18:00',
  '18:00-20:00',
] as const;

export interface SlotOption {
  slot: string;
  /** "10:00 AM – 12:00 PM". */
  label: string;
  /** The window the job is booked in now, so "leave the time alone" is one tap. */
  current: boolean;
  /** Already over on the day being moved to. Never offered. */
  past: boolean;
}

/**
 * The windows for a day, in order, each knowing whether it has already gone.
 *
 * The job's own window is kept in the list even when it is not one of the
 * standard ones — a job dispatch booked for 09:30-11:30 must still be movable
 * to another *day* at the same time, and dropping it would silently retime the
 * visit the technician only meant to move.
 */
export function slotOptions(
  dateIso: string,
  todayIso: string,
  nowMinutes: number,
  currentSlot?: string,
): SlotOption[] {
  const slots = new Set<string>(SLOT_CHOICES);
  if (currentSlot && parseSlot(currentSlot)) slots.add(currentSlot.trim());

  return [...slots]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((slot) => ({
      slot,
      label: formatSlot(slot, false),
      current: slot === currentSlot?.trim(),
      // A window counts as gone only once it has *ended*: a technician
      // standing on a job at 10:30 may well be booking themselves into the
      // window they are already in.
      past:
        dateIso < todayIso ||
        (dateIso === todayIso && (parseSlot(slot)?.end ?? 0) <= nowMinutes),
    }));
}

/** Why a move was refused. */
export type RescheduleRefusal = 'past_day' | 'past_slot' | 'no_time';

/**
 * The last gate before a move is queued.
 *
 * The sheet already refuses to offer a past day or a window that has ended, so
 * this should never fire — which is exactly why it is here. The sheet can be
 * open across midnight, or across the end of a window, and the tap that lands
 * a second after either is the accident this catches.
 */
export function refuseReason(
  next: RescheduleDealBody,
  todayIso: string,
  nowMinutes: number,
): RescheduleRefusal | null {
  if (next.scheduledDate < todayIso) return 'past_day';
  if (!next.allDay && !next.scheduledTimeSlot) return 'no_time';
  if (next.allDay) return null;
  const parsed = parseSlot(next.scheduledTimeSlot);
  if (!parsed) return 'no_time';
  if (next.scheduledDate === todayIso && parsed.end <= nowMinutes) return 'past_slot';
  return null;
}

/**
 * A move the app refused to make. Carries the reason so the screen can say it
 * in the technician's own words rather than parsing a message string.
 */
export class RescheduleRefused extends Error {
  constructor(readonly refusal: RescheduleRefusal) {
    super(describeRefusal(refusal));
    this.name = 'RescheduleRefused';
  }
}

export function describeRefusal(refusal: RescheduleRefusal): string {
  switch (refusal) {
    case 'past_day':
      return 'That day has already gone. A visit can only be moved to today or a day after it.';
    case 'past_slot':
      return 'That window has already ended today. Pick a later one, or another day.';
    case 'no_time':
      return 'Pick a time window, or All day.';
  }
}

/** "Thu, Sep 18 · 10:00 AM – 12:00 PM" — what the confirm button promises. */
export function describeMove(next: RescheduleDealBody): string {
  return `${formatDayHeading(next.scheduledDate)} · ${formatSlot(
    next.scheduledTimeSlot,
    next.allDay,
  )}`;
}

/**
 * What goes on the wire.
 *
 * `allDay` is always stated, never left out. `PUT /deals/:id` writes only the
 * fields it is given (deals.service.ts:495-499), so a job dispatch booked as
 * all-day, moved here into a window, would keep `allDay: true` and go on
 * reading "All day" over a time slot it now has.
 */
export function buildReschedule(
  dateIso: string,
  slot: string | undefined,
  allDay: boolean,
): RescheduleDealBody {
  return allDay
    ? { scheduledDate: dateIso, allDay: true }
    : { scheduledDate: dateIso, scheduledTimeSlot: slot, allDay: false };
}
