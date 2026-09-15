import { DEFAULT_TIMEZONE } from '@bitcrm/types';

/**
 * Timezone-aware formatting for the date/time short codes. Two kinds of
 * input reach it: wall-clock values a deal already stores in its own zone
 * (`YYYY-MM-DD`, `HH:MM`), which must NOT be shifted, and ISO instants
 * (`…Z`), which are rendered in the resolved zone. Output follows the Workiz
 * UI (`Sep 11 2026`, `6:10 AM`) with a comma before the year.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Intl (ICU 72+) puts U+202F before AM/PM; SMS clients render it as a box. */
const plainSpaces = (s: string) => s.replace(/[  ]/g, ' ');

/** A valid IANA zone, else `fallback` (Intl throws RangeError on an unknown one). */
export function resolveTimezone(candidate?: string, fallback: string = DEFAULT_TIMEZONE): string {
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return candidate;
    } catch {
      // fall through
    }
  }
  return fallback;
}

export function formatDate(value: string | undefined, timezone: string): string | undefined {
  if (!value) return undefined;
  const dateOnly = DATE_ONLY.exec(value);
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const instant = Date.UTC(Number(y), Number(m) - 1, Number(d));
    return plainSpaces(new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(instant));
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return undefined;
  return plainSpaces(
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: resolveTimezone(timezone) }).format(instant),
  );
}

export function formatTime(value: string | undefined, timezone: string): string | undefined {
  if (!value) return undefined;
  const timeOnly = TIME_ONLY.exec(value);
  if (timeOnly) {
    const hours = Number(timeOnly[1]);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    return `${hours % 12 || 12}:${timeOnly[2]} ${suffix}`;
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return undefined;
  return plainSpaces(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: resolveTimezone(timezone),
    }).format(instant),
  );
}

/** `HH:MM-HH:MM` → its two halves; anything else → nothing. */
export function splitTimeSlot(slot?: string): { start?: string; end?: string } {
  if (!slot) return {};
  const [start, end] = slot.split('-').map((s) => s.trim());
  return { start: start || undefined, end: end || undefined };
}
