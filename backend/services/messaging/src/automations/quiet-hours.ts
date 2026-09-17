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

/**
 * The next instant at local wall-clock `hhmm` in `timezone`, strictly after
 * `now` — when a held message goes out. Computed by adding the minutes
 * until that time rather than by building a local date, which keeps it
 * right across a DST change to within the hour the clock itself moved.
 */
export function nextLocalTime(hhmm: string, timezone: string, now: Date = new Date()): Date {
  const target = toMinutes(hhmm);
  if (target === undefined) return now;
  const t = localMinutes(now, timezone);
  const delta = (target - t + 1440) % 1440 || 1440;
  return new Date(now.getTime() + delta * 60_000);
}

/** When the quiet-hours window `now` falls in ends; `now` itself when none is running. */
export function quietHoursEnd(quietHours: QuietHours | undefined, now: Date = new Date()): Date {
  if (!quietHours || !isWithinQuietHours(quietHours, now)) return now;
  return nextLocalTime(quietHours.to, quietHours.timezone, now);
}

/** A rule's own window (Workiz per-rule "working hours"): is `now` outside it? */
export function isOutsideWorkingHours(
  window: { from: string; to: string } | undefined,
  timezone: string,
  now: Date = new Date(),
): boolean {
  if (!window) return false;
  const from = toMinutes(window.from);
  const to = toMinutes(window.to);
  if (from === undefined || to === undefined || from === to) return false;
  const t = localMinutes(now, timezone);
  const inside = from < to ? t >= from && t < to : t >= from || t < to;
  return !inside;
}

/** When the rule's window opens again; `now` when it is already open. */
export function workingHoursStart(
  window: { from: string; to: string } | undefined,
  timezone: string,
  now: Date = new Date(),
): Date {
  if (!window || !isOutsideWorkingHours(window, timezone, now)) return now;
  return nextLocalTime(window.from, timezone, now);
}
