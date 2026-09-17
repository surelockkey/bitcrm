export const MS_PER_MINUTE = 60_000;

/**
 * Billable minutes for a span, from the server's own two stamps.
 *
 * Rounded, not truncated: a 4 m 40 s call-out is four minutes of pay under
 * truncation and five under rounding, and the second is what a person expects
 * when the app showed "4:40". The minimum-separation rule is checked on raw
 * milliseconds, never on this number, so rounding can never turn a 30-second
 * double-tap into a billable minute.
 */
export function minutesBetween(startedAt: string, endedAt: string): number {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Math.round(ms / MS_PER_MINUTE);
}

/** Raw span in milliseconds; negative if the stamps are out of order. */
export function elapsedMs(startedAt: string, endedAt: string): number {
  return Date.parse(endedAt) - Date.parse(startedAt);
}
