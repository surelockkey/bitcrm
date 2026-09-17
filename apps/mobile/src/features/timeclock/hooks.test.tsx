import { renderHook, waitFor } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../lib/api/errors';
import type { QueueRecord } from '../../lib/queue/types';
import { createTestQueryClient, withQuery } from '../../test/query';
import * as api from './api';
import * as permission from '../location/permission';
import { useClockActions, useClockState, useTimesheet } from './hooks';
import type { TimeClockEntry } from './types';

jest.mock('./api');
jest.mock('../location/permission');

const mockApi = api as jest.Mocked<typeof api>;
const mockPermission = permission as jest.Mocked<typeof permission>;

// `mock`-prefixed, because Jest forbids a module factory from referencing
// anything else out of scope (see `jest.setup.ts`).
const mockEnqueueAction = jest.fn<Promise<string>, [unknown]>();
const mockPatchActionPayload = jest.fn<Promise<void>, [string, object]>();
let mockRecords: QueueRecord[] = [];

jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({
    records: mockRecords,
    enqueueAction: mockEnqueueAction,
    patchActionPayload: mockPatchActionPayload,
  }),
}));

const local = (dateIso: string, clock: string): string =>
  new Date(`${dateIso}T${clock}`).toISOString();

const entry = (over: Partial<TimeClockEntry> = {}): TimeClockEntry => ({
  id: 'e1',
  userId: 'tech-1',
  startedAt: local('2026-09-17', '09:00:00'),
  endedAt: local('2026-09-17', '11:00:00'),
  minutes: 120,
  source: 'mobile',
  createdAt: local('2026-09-17', '09:00:00'),
  updatedAt: local('2026-09-17', '11:00:00'),
  ...over,
});

const wrapper = () => withQuery(createTestQueryClient());

/**
 * The actions and the state together, because the guards inside the actions
 * read the state: a test that acted before the running entry had landed in the
 * cache would prove nothing.
 */
const useClock = () => ({ actions: useClockActions(), clock: useClockState() });

beforeEach(() => {
  mockRecords = [];
  mockEnqueueAction.mockReset().mockResolvedValue('row-1');
  mockPatchActionPayload.mockReset().mockResolvedValue(undefined);
  mockApi.getCurrentClock.mockReset().mockResolvedValue(null);
  mockApi.listClockEntries.mockReset().mockResolvedValue({ entries: [], totalMinutes: 0 });
  mockPermission.currentPositionIfPermitted.mockReset().mockResolvedValue(undefined);
});

describe('useClockActions — clocking in', () => {
  it('queues it rather than sending it, with the moment the phone recorded', async () => {
    // Clocking in with no signal is the normal case in a basement, so there is
    // only ever one path: the outbox.
    const { result } = await renderHook(() => useClockActions(), { wrapper: wrapper() });
    await result.current.clockIn();

    expect(mockEnqueueAction).toHaveBeenCalledTimes(1);
    const queued = mockEnqueueAction.mock.calls[0]![0] as {
      kind: string;
      dealId: string;
      payload: { source: string; clientStartedAt: string };
    };
    expect(queued.kind).toBe('timeclock_in');
    expect(queued.dealId).toBe('');
    expect(queued.payload.source).toBe('mobile');
    expect(Number.isFinite(Date.parse(queued.payload.clientStartedAt))).toBe(true);
  });

  it('carries the job when it was started from one', async () => {
    const { result } = await renderHook(() => useClockActions(), { wrapper: wrapper() });
    await result.current.clockIn('deal-7');

    expect(mockEnqueueAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timeclock_in', dealId: 'deal-7' }),
    );
  });

  it('never asks the phone for a fix it has not been given permission for', async () => {
    // The system prompt belongs on the screen that explains it, not on top of
    // the button that starts somebody's shift.
    const { result } = await renderHook(() => useClockActions(), { wrapper: wrapper() });
    await result.current.clockIn();

    expect(mockPermission.currentPositionIfPermitted).toHaveBeenCalled();
    // A refusal is not an error: the row is queued either way.
    expect(mockPatchActionPayload).not.toHaveBeenCalled();
    expect(mockEnqueueAction).toHaveBeenCalledTimes(1);
  });

  it('folds a fix in afterwards, so the clock starts before the GPS answers', async () => {
    mockPermission.currentPositionIfPermitted.mockResolvedValue({
      lat: 41.76,
      lng: -72.68,
      accuracy: 12,
    });
    const { result } = await renderHook(() => useClockActions(), { wrapper: wrapper() });
    await result.current.clockIn();

    expect(mockPatchActionPayload).toHaveBeenCalledWith('row-1', {
      lat: 41.76,
      lng: -72.68,
      accuracy: 12,
    });
  });

  it('will not start a second clock on top of a running one', async () => {
    mockApi.getCurrentClock.mockResolvedValue(
      entry({ endedAt: undefined, minutes: undefined }),
    );
    const { result } = await renderHook(useClock, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.clock.state.status).toBe('on'));

    await result.current.actions.clockIn();
    expect(mockEnqueueAction).not.toHaveBeenCalled();
  });
});

describe('useClockActions — clocking out', () => {
  const running = (startedAt: string) =>
    entry({ startedAt, endedAt: undefined, minutes: undefined });

  it('queues the stop with the phone’s own stamp', async () => {
    mockApi.getCurrentClock.mockResolvedValue(
      running(new Date(Date.now() - 3_600_000).toISOString()),
    );
    const { result } = await renderHook(useClock, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.clock.state.status).toBe('on'));

    await result.current.actions.clockOut();

    const queued = mockEnqueueAction.mock.calls[0]![0] as {
      kind: string;
      payload: { clientEndedAt: string };
    };
    expect(queued.kind).toBe('timeclock_out');
    expect(Number.isFinite(Date.parse(queued.payload.clientEndedAt))).toBe(true);
  });

  it('holds Workiz’s one-minute rule before the row exists (§1.7)', async () => {
    // An in/out pair tapped underground would otherwise land as a zero-minute
    // entry somebody in the office has to find and delete.
    mockApi.getCurrentClock.mockResolvedValue(
      running(new Date(Date.now() - 10_000).toISOString()),
    );
    const { result } = await renderHook(useClock, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.clock.state.status).toBe('on'));

    await result.current.actions.clockOut();
    expect(mockEnqueueAction).not.toHaveBeenCalled();
  });

  it('does nothing at all when no clock is running', async () => {
    const { result } = await renderHook(() => useClockActions(), { wrapper: wrapper() });
    await result.current.clockOut();
    expect(mockEnqueueAction).not.toHaveBeenCalled();
  });
});

describe('useClockState', () => {
  it('says "on the clock" from the server’s running entry', async () => {
    const running = entry({ endedAt: undefined, minutes: undefined });
    mockApi.getCurrentClock.mockResolvedValue(running);

    const { result } = await renderHook(() => useClockState(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.state.status).toBe('on'));
  });

  it('does not sit on a spinner while a queued clock-in already answers it', async () => {
    mockRecords = [
      {
        queue: 'outbox',
        id: 'row-9',
        userId: 'tech-1',
        kind: 'timeclock_in',
        dealId: '',
        payload: JSON.stringify({
          source: 'mobile',
          clientStartedAt: local('2026-09-17', '09:00:00'),
        }),
        createdAt: 1,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        state: 'pending',
      },
    ];
    // The request is still in the air (a basement); the row is the answer.
    mockApi.getCurrentClock.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useClockState(), { wrapper: wrapper() });

    expect(result.current.state.status).toBe('starting');
    expect(result.current.isLoading).toBe(false);
  });

  it('admits it does not know yet while the server is being asked', async () => {
    // A phone with an empty cache — a fresh install, or the technician before
    // this one having signed out — cannot say whether a clock is already
    // running until this answers. Nothing may offer "Clock in" on the strength
    // of a question that has not come back.
    mockApi.getCurrentClock.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useClockState(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.state.status).toBe('off');
  });

  it('is not "still asking" in a basement, where nothing is being asked at all', async () => {
    /*
     * With no connection react-query pauses the request rather than running it,
     * and a paused query stays *pending* for as long as the basement lasts.
     * Read as "the answer is on its way", that disables the clock-in button for
     * the whole time a technician is underground — which is precisely when the
     * outbox is supposed to take the tap.
     */
    onlineManager.setOnline(false);
    try {
      const { result } = await renderHook(() => useClockState(), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.state.status).toBe('off'));
      expect(result.current.isLoading).toBe(false);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('useTimesheet', () => {
  it('asks for one week and works today out from it', async () => {
    // Two requests for overlapping ranges, over a van's connection, to print a
    // second total on the same screen is a request nobody needs.
    mockApi.listClockEntries.mockResolvedValue({
      entries: [
        entry({ id: 'a', minutes: 120 }),
        entry({
          id: 'b',
          startedAt: local('2026-09-16', '08:00:00'),
          endedAt: local('2026-09-16', '12:00:00'),
          minutes: 240,
        }),
      ],
      totalMinutes: 999,
    });

    const { result } = await renderHook(() => useTimesheet('2026-09-17'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.days).toHaveLength(2));
    expect(mockApi.listClockEntries).toHaveBeenCalledTimes(1);
    expect(result.current.todayMinutes).toBe(120);
    expect(result.current.weekMinutes).toBe(360);
  });

  it('sums the entries itself rather than trusting the server’s total', async () => {
    // The contract does not say whether `totalMinutes` counts an entry that is
    // still running, and a total that climbs while you watch it is worse than
    // no total at all.
    mockApi.listClockEntries.mockResolvedValue({
      entries: [
        entry({ id: 'done', minutes: 60 }),
        entry({ id: 'running', endedAt: undefined, minutes: undefined }),
      ],
      totalMinutes: 500,
    });

    const { result } = await renderHook(() => useTimesheet('2026-09-17'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.weekMinutes).toBe(60);
  });

  it('says the week was never asked for, rather than that it is on its way', async () => {
    // With no connection the request is paused, not sent: reported as "still
    // loading" it would leave the timesheet spinning for the whole of the
    // basement, where the screen's other half — the clock — still works.
    onlineManager.setOnline(false);
    try {
      const { result } = await renderHook(() => useTimesheet('2026-09-17'), {
        wrapper: wrapper(),
      });

      await waitFor(() => expect(result.current.offline).toBe(true));
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeUndefined();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('admits the rows are the phone’s own copy when the read failed', async () => {
    mockApi.listClockEntries.mockRejectedValue(new ApiError(0, 'Unable to reach the server.'));

    const { result } = await renderHook(() => useTimesheet('2026-09-17'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.days).toEqual([]);
  });
});
