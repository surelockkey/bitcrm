import { type CalendarEventType } from '../enums/calendar-event-type.enum';

/**
 * A non-job block on a technician's day (time off, lunch, break, appointment),
 * shown on the schedule and treated as a conflict when a job overlaps it.
 *
 * Time model (kept coherent with the deal `scheduledTimeSlot` convention):
 * - `allDay === true`  → whole day(s) blocked; `timeSlot` omitted; `startDate`
 *   and `endDate` may span multiple days (e.g. vacation).
 * - `allDay === false` → a single day (`endDate === startDate`) with a required
 *   `timeSlot` "HH:MM-HH:MM" (e.g. lunch). Overlap math then matches deals'.
 */
export interface CalendarEvent {
  id: string;
  technicianId: string;
  type: CalendarEventType;
  title: string;
  /** Inclusive local date "YYYY-MM-DD". */
  startDate: string;
  /** Inclusive local date "YYYY-MM-DD"; equals `startDate` for a single day. */
  endDate: string;
  allDay: boolean;
  /** "HH:MM-HH:MM" (24h). Present only when `allDay` is false. */
  timeSlot?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
