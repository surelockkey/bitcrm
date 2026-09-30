import { DEFAULT_TIMEZONE } from '@bitcrm/types';

/**
 * Date helpers for documents. Two kinds of input: wall-clock dates the
 * system already stores in the business's zone (`YYYY-MM-DD`), which are
 * never shifted, and ISO instants, which are projected into a zone.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimezone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(candidate?: string | null): string {
  return candidate && isValidTimezone(candidate) ? candidate : DEFAULT_TIMEZONE;
}

/** `YYYY-MM-DD` of an instant in a zone. */
export function dateIn(instant: string | Date, timezone: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function todayIn(timezone: string, now: Date = new Date()): string {
  return dateIn(now, timezone);
}

/** Calendar arithmetic on a `YYYY-MM-DD`. */
export function addDays(ymd: string, days: number): string {
  const m = DATE_ONLY.exec(ymd);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${ymd}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function isYmd(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value);
}

/** "Sep 5, 2026". */
export function formatDisplayDate(value: string | undefined | null, timezone: string): string | undefined {
  if (!value) return undefined;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const m = DATE_ONLY.exec(value);
  if (m) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(t);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: resolveTimezone(timezone) }).format(d);
}
