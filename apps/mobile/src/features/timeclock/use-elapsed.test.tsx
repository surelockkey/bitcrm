import { act } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { HALF_MINUTE_MS, SECOND_MS, useElapsed, useNow } from './use-elapsed';

/**
 * The one property this hook exists to have: the number on screen is right
 * after the phone has been asleep.
 *
 * A phone in a pocket between two jobs suspends its timers, so a counter that
 * added a second per tick would be minutes short by the time the technician
 * looked at it. These tests suspend the clock the way a pocket does — the
 * system time moves while no interval runs — and assert the readout is exactly
 * right on the first tick afterwards, with nothing to catch up on.
 */

const started = '2026-09-17T09:00:00.000Z';
const startedMs = Date.parse(started);

/**
 * The app coming back to the foreground.
 *
 * `AppState` under `jest-expo` has no emitter to drive, so the listener the
 * hook registers is captured and called directly.
 */
function captureForeground(): () => void {
  let handler: ((status: AppStateStatus) => void) | undefined;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type: string, cb: (status: AppStateStatus) => void) => {
      handler = cb;
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });
  return () => act(() => handler?.('active'));
}

describe('useElapsed', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    // Straight back to real timers, without draining what is pending: the
    // component is still mounted at this point, so firing its interval here
    // would be a state update outside `act`.
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('counts from the start stamp, not from when the screen opened', async () => {
    // A technician who clocked in two hours ago and opens the app now sees two
    // hours, not zero.
    jest.setSystemTime(startedMs + 2 * 3_600_000);
    const { result } = await renderHook(() => useElapsed(started, SECOND_MS));
    expect(result.current).toBe(2 * 3_600_000);
  });

  it('is correct after the phone slept through every tick', async () => {
    jest.setSystemTime(startedMs + 1_000);
    const { result } = await renderHook(() => useElapsed(started, SECOND_MS));
    expect(result.current).toBe(1_000);

    // Three hours pass with the phone in a pocket: the interval never ran.
    jest.setSystemTime(startedMs + 3 * 3_600_000 - SECOND_MS);
    act(() => {
      jest.advanceTimersByTime(SECOND_MS);
    });

    // One tick, and it is exactly right — there is nothing to catch up on,
    // because nothing was ever accumulated.
    expect(result.current).toBe(3 * 3_600_000);
  });

  it('recomputes the instant the app comes back, without waiting for a tick', async () => {
    const wake = captureForeground();
    jest.setSystemTime(startedMs);
    const { result } = await renderHook(() => useElapsed(started, HALF_MINUTE_MS));

    // At half a minute's resolution the screen would otherwise show a stale
    // figure for up to thirty seconds after the technician looked at it again.
    jest.setSystemTime(startedMs + 4 * 3_600_000);
    wake();

    expect(result.current).toBe(4 * 3_600_000);
  });

  it('counts nothing, and re-renders for nothing, off the clock', async () => {
    jest.setSystemTime(startedMs);
    const counter = { renders: 0 };
    const { result } = await renderHook(() => {
      counter.renders += 1;
      return useElapsed(null, SECOND_MS);
    });

    expect(result.current).toBe(0);
    const before = counter.renders;

    act(() => {
      jest.advanceTimersByTime(10 * SECOND_MS);
    });

    // A screen that re-renders once a second all day for nothing is a battery
    // the technician needs at 6pm.
    expect(counter.renders).toBe(before);
    expect(result.current).toBe(0);
  });

  it('stops counting when the clock stops', async () => {
    jest.setSystemTime(startedMs);
    const counter = { renders: 0 };
    const { result, rerender } = await renderHook(
      ({ at }: { at: string | null }) => {
        counter.renders += 1;
        return useElapsed(at, SECOND_MS);
      },
      { initialProps: { at: started as string | null } },
    );

    await rerender({ at: null });
    expect(result.current).toBe(0);

    const before = counter.renders;
    act(() => {
      jest.advanceTimersByTime(10 * SECOND_MS);
    });
    expect(counter.renders).toBe(before);
  });
});

describe('useNow', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    // Straight back to real timers, without draining what is pending: the
    // component is still mounted at this point, so firing its interval here
    // would be a state update outside `act`.
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reads the real clock on every tick rather than adding to its own', async () => {
    jest.setSystemTime(startedMs);
    const { result } = await renderHook(() => useNow(SECOND_MS));

    jest.setSystemTime(startedMs + 90_000 - SECOND_MS);
    act(() => {
      jest.advanceTimersByTime(SECOND_MS);
    });

    expect(result.current).toBe(startedMs + 90_000);
  });
});
