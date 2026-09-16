import { type AutomationTrigger } from '@bitcrm/types';
import { resolveTimezone, splitTimeSlot } from '../../templates/date-format';
import { type AutomationDealFacts } from './facts';

/**
 * A job's dates are wall-clock in its own zone (`2026-09-20`,
 * `09:00-11:00`), so "one hour before the job" has to be resolved against
 * that zone before it can become an instant. `Date.UTC` of the wall clock
 * minus the zone's offset at that moment gives it; one refinement pass
 * settles the two hours a year when the offset the guess was made in is not
 * the offset the answer lands in (DST).
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return (asUtc - instant.getTime()) / 60_000;
}

/** `YYYY-MM-DD` + `HH:MM` in `timezone` → the instant it names. */
export function wallClockToUtc(date: string, time: string | undefined, timezone: string): Date | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!d) return undefined;
  const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((time ?? '00:00').trim());
  const zone = resolveTimezone(timezone);
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), t ? Number(t[1]) : 0, t ? Number(t[2]) : 0);
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), zone) * 60_000);
  return new Date(naive - offsetMinutes(firstGuess, zone) * 60_000);
}

/**
 * The instant a `schedule.relative` trigger counts from: the job's start or
 * end (wall clock in its zone), the last status change or the creation
 * (both already instants). `undefined` when the job does not carry it —
 * an unscheduled job arms no reminder.
 */
export function anchorInstant(
  trigger: AutomationTrigger,
  deal: AutomationDealFacts,
  timezone: string,
): Date | undefined {
  switch (trigger.anchor ?? 'scheduledStart') {
    case 'scheduledStart': {
      if (!deal.scheduledDate) return undefined;
      return wallClockToUtc(deal.scheduledDate, splitTimeSlot(deal.scheduledTimeSlot).start, timezone);
    }
    case 'scheduledEnd': {
      const date = deal.scheduledEndDate ?? deal.scheduledDate;
      if (!date) return undefined;
      return wallClockToUtc(date, splitTimeSlot(deal.scheduledTimeSlot).end, timezone);
    }
    case 'statusChangedAt':
      return deal.statusChangedAt ? new Date(deal.statusChangedAt) : undefined;
    case 'createdAt':
      return deal.createdAt ? new Date(deal.createdAt) : undefined;
    default:
      return undefined;
  }
}

/** Anchor + offset — when the reminder is due. */
export function dueInstant(
  trigger: AutomationTrigger,
  deal: AutomationDealFacts,
  timezone: string,
): { anchorAt: Date; dueAt: Date } | undefined {
  const anchorAt = anchorInstant(trigger, deal, timezone);
  if (!anchorAt || Number.isNaN(anchorAt.getTime())) return undefined;
  return { anchorAt, dueAt: new Date(anchorAt.getTime() + (trigger.offsetMinutes ?? 0) * 60_000) };
}
