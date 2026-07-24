import { type CalendarEvent, type CalendarEventType } from '@bitcrm/types';
import { MAX_EVENT_DAYS } from '../constants/dynamo.constants';

/** The mutable fields of a calendar event, as a create/update DTO carries them. */
export interface CalendarEventDraft {
  type: CalendarEventType;
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  timeSlot?: string;
}

const SLOT_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY;
}

/**
 * Enforce the one coherent time model:
 * - all-day ⇒ no slot; may span multiple days (≤ cap)
 * - timed   ⇒ single day (start === end) with a valid "HH:MM-HH:MM" slot
 * Returns an error message, or null when the shape is valid.
 */
export function validateEventShape(draft: CalendarEventDraft): string | null {
  const span = daysBetween(draft.startDate, draft.endDate);
  if (Number.isNaN(span)) return 'startDate and endDate must be valid dates';
  if (span < 0) return 'endDate cannot be before startDate';
  if (span > MAX_EVENT_DAYS) return `An event cannot span more than ${MAX_EVENT_DAYS} days`;

  if (draft.allDay) {
    if (draft.timeSlot) return 'An all-day event cannot have a timeSlot';
  } else {
    if (span !== 0) return 'A timed event must be a single day (startDate === endDate)';
    if (!draft.timeSlot) return 'A timed event requires a timeSlot';
    if (!SLOT_RE.test(draft.timeSlot)) return 'timeSlot must match HH:MM-HH:MM';
  }
  return null;
}

/** Whether the event's inclusive [startDate, endDate] span covers `dateISO`. */
export function eventOverlapsDate(event: CalendarEvent, dateISO: string): boolean {
  return event.startDate <= dateISO && dateISO <= event.endDate;
}

/** The subset of events that touch `dateISO`. */
export function eventsForDate(events: CalendarEvent[], dateISO: string): CalendarEvent[] {
  return events.filter((e) => eventOverlapsDate(e, dateISO));
}
