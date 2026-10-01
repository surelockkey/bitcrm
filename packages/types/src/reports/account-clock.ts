import { DEFAULT_TIMEZONE } from '../entities/service-area.entity';

/**
 * The account's calendar, for reports that count by the business's day.
 *
 * Workiz answers every report on the account's clock (America/New_York for
 * this business): "Sep 1" is 00:00–24:00 Eastern, not UTC. Our records carry
 * UTC instants, so a report window has to be turned into instants before it
 * can touch an index, and each instant back into a day (or an hour of the day)
 * before it can be bucketed. Shared by the services and the browser so both
 * name the same days.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Formatter per zone — building one costs far more than using it. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms (negative west of Greenwich). */
export function zoneOffsetMs(instant: number, timeZone: string = DEFAULT_TIMEZONE): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** `day` shifted by `n` whole days (YYYY-MM-DD in, YYYY-MM-DD out). */
export function shiftAccountDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The UTC instant (ISO, ms, `Z`) at which `day` starts on the account's clock.
 * Twice through the offset: the first guess can sit on the other side of a
 * clock change.
 */
export function accountDayStartUtc(day: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d);
  const first = naive - zoneOffsetMs(naive, timeZone);
  return new Date(naive - zoneOffsetMs(first, timeZone)).toISOString();
}

/**
 * The half-open UTC window `[start, end)` covering the account days `from`..`to`
 * (both included).
 */
export function accountWindowUtc(
  from: string,
  to: string,
  timeZone: string = DEFAULT_TIMEZONE,
): { start: string; end: string } {
  return {
    start: accountDayStartUtc(from, timeZone),
    end: accountDayStartUtc(shiftAccountDay(to, 1), timeZone),
  };
}

/**
 * Turns UTC instants into the account's wall clock, fast. The offset only
 * changes twice a year, so it is looked up once per UTC hour and reused —
 * a year of calls is ~350k instants, and a formatter call per instant is
 * seconds of CPU.
 */
export class AccountClock {
  private readonly byHour = new Map<string, number>();

  constructor(readonly timeZone: string = DEFAULT_TIMEZONE) {}

  /** The local wall-clock parts of an ISO instant. */
  local(iso: string): { day: string; hour: number; month: string } {
    const hourKey = iso.slice(0, 13);
    let offset = this.byHour.get(hourKey);
    const t = Date.parse(iso);
    if (offset === undefined) {
      offset = zoneOffsetMs(t, this.timeZone);
      this.byHour.set(hourKey, offset);
    }
    const local = new Date(t + offset);
    const day = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
    return { day, hour: local.getUTCHours(), month: day.slice(0, 7) };
  }

  /** YYYY-MM-DD of an ISO instant on the account's clock. */
  day(iso: string): string {
    return this.local(iso).day;
  }
}

/** Every day from `from` to `to`, inclusive, in order. */
export function accountDaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 40_000; d = shiftAccountDay(d, 1)) out.push(d);
  return out;
}

/** The Sunday that starts `day`'s week (US weeks, as Workiz's pickers count them). */
export function weekStartSunday(day: string): string {
  const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return shiftAccountDay(day, -dow);
}
