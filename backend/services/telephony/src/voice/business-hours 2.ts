import { type HoursNode } from '@bitcrm/types';

/**
 * Is this moment inside the flow's opening hours?
 *
 * Everything here is computed in the flow's own timezone rather than the
 * server's, via Intl — which also means DST is handled by the platform's
 * tzdata instead of by arithmetic that is wrong twice a year. A workspace in
 * Phoenix and a container in UTC otherwise disagree about what "open" means,
 * and the disagreement shows up as calls going to voicemail at 9am.
 */
export function isWithinBusinessHours(node: HoursNode, now: Date): boolean {
  const { timezone, windows, holidays } = node;
  if (!windows?.length) return false;

  const local = readInZone(now, timezone);
  if (!local) return false;

  // A holiday closes the day whatever the windows say.
  if (holidays?.includes(local.date)) return false;

  return windows.some((window) => {
    if (window.day !== local.weekday) return false;
    const open = toMinutes(window.open);
    const close = toMinutes(window.close);
    if (open === null || close === null) return false;
    // A window that ends before it starts crosses midnight — 22:00–02:00 is a
    // real shift, and treating it as an empty range would silently close the line.
    return close > open
      ? local.minutes >= open && local.minutes < close
      : local.minutes >= open || local.minutes < close;
  });
}

interface LocalTime {
  /** `YYYY-MM-DD` in the target zone. */
  date: string;
  /** 0 = Sunday, matching the stored windows. */
  weekday: number;
  /** Minutes since midnight. */
  minutes: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function readInZone(now: Date, timezone: string): LocalTime | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const weekday = WEEKDAYS.indexOf(get('weekday'));
    // Midnight comes back as 24 in some ICU versions.
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    if (weekday < 0 || Number.isNaN(hour) || Number.isNaN(minute)) return null;

    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      weekday,
      minutes: hour * 60 + minute,
    };
  } catch {
    // An unknown timezone must not decide the call — the caller falls back.
    return null;
  }
}

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
