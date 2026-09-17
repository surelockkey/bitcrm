import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/api/query-keys';
import { hapticSuccess } from '../../lib/haptics';
import { findDealById } from '../jobs/hooks';
import { localDateIso } from '../jobs/lib';
import type { Deal } from '../jobs/types';
import { currentPositionIfPermitted } from '../location/permission';
import { useQueue } from '../queue/queue-provider';
import { getCurrentClock, listClockEntries } from './api';
import {
  CLOCK_IN,
  CLOCK_OUT,
  canClockOut,
  clockStartedAt,
  deriveClockState,
  entriesOnDay,
  failedClockRows,
  formatElapsedShort,
  groupEntriesByDay,
  isOnTheClock,
  sumFinishedMinutes,
  weekRange,
  type ClockDayGroup,
  type ClockState,
  type OutboxQueueRecord,
} from './lib';
import type { ClockInPayload, ClockOutPayload, TimeClockEntry } from './types';
import { HALF_MINUTE_MS, useElapsed } from './use-elapsed';

/** The running entry is checked often; it is the cheapest question here. */
const CURRENT_STALE_MS = 30_000;

export interface UseClockStateResult {
  state: ClockState;
  /**
   * Clock rows the queue gave up on, and rows nobody can call either way —
   * unrecorded hours if nobody notices them.
   */
  failed: OutboxQueueRecord[];
  /**
   * The server is being asked right now and nothing else can answer.
   *
   * Deliberately `isLoading` rather than `isPending`: with no connection
   * react-query pauses the request instead of running it, and a paused query is
   * pending for as long as the basement lasts. Gating the button on that would
   * be a technician who cannot start their shift — the exact failure the outbox
   * exists to prevent.
   */
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Is the technician on the clock, and since when.
 *
 * The server's answer and the outbox, resolved together (`lib.ts`). Clocking in
 * happens in basements — the request may not have left the phone yet — so the
 * queued row is what the screen believes until the server can be asked.
 */
export function useClockState(): UseClockStateResult {
  const { records } = useQueue();
  const query = useQuery<TimeClockEntry | null>({
    queryKey: queryKeys.timeclock.current(),
    queryFn: getCurrentClock,
    staleTime: CURRENT_STALE_MS,
    /**
     * The one query in this app that is re-asked on every return to the screen.
     *
     * A clock can be stopped from the office's web app, and this answer is what
     * gates location sharing: left on a cached "yes", the phone would go on
     * reporting a technician's position for a shift that ended an hour ago.
     * `staleTime` keeps it to at most one request every thirty seconds.
     */
    refetchOnWindowFocus: true,
  });

  const state = useMemo(
    () => deriveClockState(query.data, records),
    [query.data, records],
  );
  const failed = useMemo(() => failedClockRows(records), [records]);

  return {
    state,
    failed,
    // A queued clock-in answers the question on its own: a technician who has
    // just tapped "Clock in" must see a clock, not a spinner.
    isLoading: query.isLoading && state.status === 'off',
    refetch: () => void query.refetch(),
  };
}

export interface UseTimesheetResult {
  /** This week's entries, newest first, grouped by the day they started on. */
  days: ClockDayGroup[];
  /** Finished minutes today. A running entry is not one of them. */
  todayMinutes: number;
  /** Finished minutes this week, same rule. */
  weekMinutes: number;
  entries: TimeClockEntry[];
  isLoading: boolean;
  isRefetching: boolean;
  error: unknown;
  /**
   * There is no connection, so the week was never asked for.
   *
   * Distinct from `error`, and the screen has to be able to tell them apart: a
   * request that is *paused* never fails, so a screen watching only `error`
   * shows its spinner for as long as the basement lasts, with nothing to read
   * and nothing to tap.
   */
  offline: boolean;
  /** True when the rows on screen are the phone's own copy of a failed read. */
  stale: boolean;
  refetch: () => void;
}

/**
 * The week a technician works, in one request.
 *
 * One range rather than two: "today" is a subset of "this week", and pulling
 * the same rows twice over a van's connection to put a second total on the same
 * screen is a request nobody needs.
 */
export function useTimesheet(todayIso: string = localDateIso()): UseTimesheetResult {
  const range = useMemo(() => weekRange(todayIso), [todayIso]);

  const query = useQuery({
    queryKey: queryKeys.timeclock.range(range.from, range.to),
    queryFn: () => listClockEntries(range),
    select: (report) => report.entries,
  });

  const entries = useMemo(() => query.data ?? [], [query.data]);
  const days = useMemo(
    () => groupEntriesByDay(entries, todayIso),
    [entries, todayIso],
  );
  const todayMinutes = useMemo(
    () => sumFinishedMinutes(entriesOnDay(entries, todayIso)),
    [entries, todayIso],
  );
  // Waiting for a connection, not for an answer.
  const offline = query.fetchStatus === 'paused';

  return {
    days,
    todayMinutes,
    weekMinutes: useMemo(() => sumFinishedMinutes(entries), [entries]),
    entries,
    // `isLoading`, not `isPending`: a request the connection has parked is not
    // one that is on its way, and spinning on it would leave a technician
    // underground looking at a spinner instead of at "No signal".
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error ?? undefined,
    offline,
    stale: (Boolean(query.error) || offline) && entries.length > 0,
    refetch: () => void query.refetch(),
  };
}

/**
 * The running clock, small enough for a tab badge: `H:MM`, or nothing at all
 * when the technician is off the clock.
 *
 * This is the "without hunting" half of the feature. A technician who is still
 * on the clock at the end of the day sees it from the job list, the chat, the
 * van and the queue — every screen with a tab bar — without opening anything.
 * It ticks twice a minute rather than once a second: the tab bar is mounted for
 * the whole shift, and a minute-resolution readout does not need 3,600 renders
 * an hour to stay honest (`use-elapsed.ts`).
 */
export function useClockBadge(): string | undefined {
  const { state } = useClockState();
  const startedAt = clockStartedAt(state);
  const elapsed = useElapsed(startedAt, HALF_MINUTE_MS);
  return startedAt ? formatElapsedShort(elapsed) : undefined;
}

/**
 * The job number behind a clock entry's `dealId`, read out of the cache.
 *
 * An entry carries the id and nothing else, and "Job 1042" is what a technician
 * recognises. The day list is already on the phone — and on disk, so this still
 * answers in a basement — so the number is looked up rather than fetched: one
 * request per row of a timesheet, over a van's connection, to print a label
 * nobody would wait for.
 */
export function useDealNumber(dealId: string | undefined): string | undefined {
  const qc = useQueryClient();
  return useMemo(() => {
    if (!dealId) return undefined;
    const cached =
      qc.getQueryData<Deal>(queryKeys.deals.detail(dealId)) ??
      findDealById(
        qc.getQueriesData<Deal[]>({ queryKey: queryKeys.deals.lists() }).map(
          ([, data]) => data,
        ),
        dealId,
      );
    return cached ? String(cached.dealNumber) : undefined;
  }, [dealId, qc]);
}

export interface ClockActions {
  /** Start the clock — for the day, or on a job when given its id. */
  clockIn: (dealId?: string) => Promise<void>;
  clockOut: () => Promise<void>;
}

/**
 * Clocking in and out, through the same durable queue as everything else.
 *
 * Both go on the outbox rather than straight to the network, for the reason
 * "Arrived" does (`features/jobs/use-job-actions.ts`): a basement is the normal
 * case, one path means the offline branch is the only branch and cannot rot,
 * and a tap that is never lost is the whole promise of the queue. Neither is
 * marked idempotent (`lib/queue/policy.ts`) — the contract gives the server no
 * key to dedupe on, so an ambiguous failure is shown to the technician instead
 * of being replayed into a second entry.
 */
export function useClockActions(): ClockActions {
  const { enqueueAction, patchActionPayload } = useQueue();
  const { state } = useClockState();

  /**
   * Queued first, located second — the pattern "Arrived" established.
   *
   * A fix can take eight seconds, and the clock has to start the moment it is
   * tapped: a technician standing in a doorway must not watch a spinner, and an
   * app killed inside that window must not lose the start of a shift. So the
   * row goes down at once with no coordinates, which the contract allows, and
   * the fix is folded in afterwards if it beats the drain.
   */
  const queueWithFix = useCallback(
    async (kind: typeof CLOCK_IN | typeof CLOCK_OUT, dealId: string, payload: unknown) => {
      const id = await enqueueAction({ kind, dealId, payload });
      hapticSuccess();
      const fix = await currentPositionIfPermitted();
      if (fix) await patchActionPayload(id, fix);
    },
    [enqueueAction, patchActionPayload],
  );

  return useMemo<ClockActions>(
    () => ({
      clockIn: async (dealId) => {
        // The screens never offer "Clock in" to somebody already on the clock;
        // this is here for the double tap that beats the re-render.
        if (isOnTheClock(state)) return;
        const payload: ClockInPayload = {
          source: 'mobile',
          clientStartedAt: new Date().toISOString(),
        };
        await queueWithFix(CLOCK_IN, dealId ?? '', payload);
      },
      clockOut: async () => {
        const startedAt = clockStartedAt(state);
        if (!startedAt) return;
        // Workiz's one-minute rule (§1.7), enforced before the row exists so an
        // in/out pair queued underground cannot land as a zero-minute entry.
        if (!canClockOut(Date.parse(startedAt), Date.now())) return;
        const payload: ClockOutPayload = { clientEndedAt: new Date().toISOString() };
        await queueWithFix(CLOCK_OUT, '', payload);
      },
    }),
    [queueWithFix, state],
  );
}
