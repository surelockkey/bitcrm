/**
 * A non-job block on a technician's calendar. Working hours are NOT modeled
 * here — they live on the technician profile, so there is one source of truth.
 */
export enum CalendarEventType {
  TIME_OFF = 'time_off',
  BREAK = 'break',
  LUNCH = 'lunch',
  APPOINTMENT = 'appointment',
}
