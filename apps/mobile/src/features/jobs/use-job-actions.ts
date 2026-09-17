import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/api/query-keys';
import { hapticSuccess } from '../../lib/haptics';
import type { OutboxKind } from '../../lib/queue/types';
import { useQueue } from '../queue/queue-provider';
import type { RescheduleDealBody } from './api';
import { useMe } from './hooks';
import { localDateIso } from './lib';
import { currentPosition } from './location';
import { applyPatchToList, optimisticPatch } from './optimistic';
import { RescheduleRefused, minutesOfDay, refuseReason } from './reschedule';
import { JobSuperStatus, type Deal } from './types';

export interface JobActions {
  /** "I've got it." */
  confirm: () => Promise<void>;
  /** Tells the client, in the workspace's own words. */
  onMyWay: (etaMinutes?: number) => Promise<void>;
  runningLate: (minutes: number) => Promise<void>;
  /** Records arrival, with the phone's fix if it offers one within 8 seconds. */
  arrive: () => Promise<void>;
  start: () => Promise<void>;
  finish: () => Promise<void>;
  addNote: (note: string) => Promise<void>;
  /** Moves the visit. Rejects rather than queueing a move into the past. */
  reschedule: (next: RescheduleDealBody) => Promise<void>;
}

/**
 * Everything a technician does to a job.
 *
 * All of it goes through the durable queue, online or not. One path means the
 * offline case is not a rarely-exercised branch that breaks quietly — it is the
 * only path there is, and the drain that follows an online tap is immediate, so
 * the two feel identical (docs/ARCHITECTURE.md §2.4).
 *
 * The cache is patched at the moment of the tap, because until the queue drains
 * that patch is the only feedback there is. When the row lands, the queue
 * invalidates the job and the server's own copy replaces the guess.
 */
export function useJobActions(dealId: string): JobActions {
  const qc = useQueryClient();
  const { enqueueAction, patchActionPayload } = useQueue();
  const { data: me } = useMe();
  const actorId = me?.id;

  const patchCache = useCallback(
    (patch: Partial<Deal>) => {
      if (Object.keys(patch).length === 0) return;
      qc.setQueryData<Deal>(queryKeys.deals.detail(dealId), (prev) =>
        prev ? { ...prev, ...patch } : prev,
      );
      // The day list shows the same stamps, so it is patched too — otherwise
      // going back one screen would show the job as if nothing had happened.
      qc.setQueriesData<Deal[]>({ queryKey: queryKeys.deals.lists() }, (list) =>
        applyPatchToList(list, dealId, patch),
      );
    },
    [dealId, qc],
  );

  const run = useCallback(
    async (kind: OutboxKind, payload: unknown) => {
      patchCache(optimisticPatch(kind, payload, new Date().toISOString(), actorId));
      const id = await enqueueAction({ kind, dealId, payload });
      hapticSuccess();
      return id;
    },
    [actorId, dealId, enqueueAction, patchCache],
  );

  return useMemo<JobActions>(
    () => ({
      confirm: () => run('confirm', {}).then(() => undefined),
      onMyWay: (etaMinutes) =>
        run('on_my_way', etaMinutes ? { etaMinutes } : {}).then(() => undefined),
      runningLate: (minutes) => run('late', { minutes }).then(() => undefined),
      /**
       * Queued first, located second.
       *
       * The fix can take up to eight seconds (`GEOLOCATION_TIMEOUT_MS`), and
       * "Arrived" is the app's hero action, tapped at a doorstep on one bar.
       * Waiting for the fix before writing the row meant eight seconds of no
       * feedback — and an app killed inside that window lost the arrival
       * outright. So the row goes down immediately with an empty body, which
       * `MarkArrivedDto` accepts, and the coordinates are folded in afterwards
       * if they arrive before the row does (§2.9).
       */
      arrive: async () => {
        const id = await run('arrived', {});
        const fix = await currentPosition();
        if (!fix) return;
        await patchActionPayload(id, fix);
        patchCache({
          arrivedLocation: {
            lat: fix.lat,
            lng: fix.lng,
            ...(typeof fix.accuracy === 'number' ? { accuracy: fix.accuracy } : {}),
          },
        });
      },
      start: () =>
        run('status', { superStatus: JobSuperStatus.IN_PROGRESS }).then(
          () => undefined,
        ),
      finish: () =>
        run('status', { superStatus: JobSuperStatus.DONE }).then(() => undefined),
      addNote: (note) => run('note', { note }).then(() => undefined),
      /**
       * The same rule the sheet drew the choices by, applied again at the tap.
       *
       * The sheet can sit open in a pocket while the day turns over or a
       * window ends, and a move into the past is not something to discover
       * from the day list two hours later — an overdue job reads as work
       * somebody forgot. Checked here rather than only in the screen so no
       * later caller can queue one by a route the sheet does not own.
       */
      reschedule: async (next) => {
        const refusal = refuseReason(next, localDateIso(), minutesOfDay());
        if (refusal) throw new RescheduleRefused(refusal);
        await run('reschedule', next);
      },
    }),
    [patchActionPayload, patchCache, run],
  );
}
