import { type QuietHours } from '@bitcrm/types';
import { resolveTimezone } from '../templates/date-format';

const HH_MM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (hhmm: string): number | undefined => {
  const m = HH_MM.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

/** Minutes since local midnight of `now` in `timezone`. */
export function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: resolveTimezone(timezone),
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * Whether `now` falls inside the settings' quiet-hours window (design §3.2
 * `quietHours {from, to, timezone}`), in which automations hold non-urgent
 * texts. `from` ≥ `to` wraps midnight (`20:00` → `08:00`); an empty or
 * unparsable window never holds anything.
 */
export function isWithinQuietHours(quietHours: QuietHours | undefined, now: Date = new Date()): boolean {
  if (!quietHours) return false;
  const from = toMinutes(quietHours.from);
  const to = toMinutes(quietHours.to);
  if (from === undefined || to === undefined || from === to) return false;
  const t = localMinutes(now, quietHours.timezone);
  return from < to ? t >= from && t < to : t >= from || t < to;
}
