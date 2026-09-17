import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { elapsedMs } from './lib';

/**
 * A clock that is still right after the phone has been asleep.
 *
 * The rule is the whole of it: **the elapsed time is subtracted from the start
 * stamp on every render, never accumulated.** A counter that added a second per
 * tick would be wrong by however long the phone suspended its timers — which,
 * in a pocket between two jobs, is most of the time — and would be wrong in
 * different directions on different shifts.
 *
 * So the ticking here does one job only: it moves `now` along so the number on
 * screen changes. Whether a tick was skipped, delayed or fired ten times makes
 * no difference to what is displayed.
 *
 * Two things keep it honest across a sleep:
 *
 *   - `Date.now()` is read at each tick, so the first tick after waking already
 *     shows the true figure — no catching up, no drift;
 *   - the app returning to the foreground recomputes immediately, so there is
 *     not even one frame of the number the screen was showing when it was put
 *     to sleep. `setInterval` is suspended while the app is backgrounded and
 *     resumes on its own schedule, which can be nearly a whole tick late.
 */

export const SECOND_MS = 1_000;

/**
 * Half a minute for anything displayed to the minute.
 *
 * A minute-resolution readout ticking once a minute can lag a full minute
 * behind; twice a minute bounds that at thirty seconds for two renders an hour.
 */
export const HALF_MINUTE_MS = 30_000;

/**
 * `Date.now()`, re-read every `tickMs` and whenever the app comes back.
 *
 * `null` stops the clock entirely — no interval, no listener, no re-render.
 * Off the clock there is nothing to count, and a screen that re-renders once a
 * second all day for nothing is a battery a technician needs at 6pm.
 */
export function useNow(tickMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (tickMs === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [tickMs]);

  return now;
}

/** How long the clock has been running, in milliseconds. 0 when it is not. */
export function useElapsed(
  startedAt: string | null,
  tickMs: number = SECOND_MS,
): number {
  const now = useNow(startedAt ? tickMs : null);
  return startedAt ? elapsedMs(startedAt, now) : 0;
}
