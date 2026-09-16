import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/api/query-keys';
import { hapticSuccess } from '../../lib/haptics';
import type { OutboxKind } from '../../lib/queue/types';
import { useQueue } from '../queue/queue-provider';
import { useMe } from './hooks';
import { currentPosition } from './location';
import { applyPatchToList, optimisticPatch } from './optimistic';
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
  const { enqueueAction } = useQueue();
  const { data: me } = useMe();
  const actorId = me?.id;

  const run = useCallback(
    async (kind: OutboxKind, payload: unknown) => {
      const patch = optimisticPatch(kind, payload, new Date().toISOString(), actorId);

      if (Object.keys(patch).length > 0) {
        qc.setQueryData<Deal>(queryKeys.deals.detail(dealId), (prev) =>
          prev ? { ...prev, ...patch } : prev,
        );
        // The day list shows the same stamps, so it is patched too — otherwise
        // going back one screen would show the job as if nothing had happened.
        qc.setQueriesData<Deal[]>({ queryKey: queryKeys.deals.lists() }, (list) =>
          applyPatchToList(list, dealId, patch),
        );
      }

      await enqueueAction({ kind, dealId, payload });
      hapticSuccess();
    },
    [actorId, dealId, enqueueAction, qc],
  );

  return useMemo<JobActions>(
    () => ({
      confirm: () => run('confirm', {}),
      onMyWay: (etaMinutes) =>
        run('on_my_way', etaMinutes ? { etaMinutes } : {}),
      runningLate: (minutes) => run('late', { minutes }),
      arrive: async () => {
        // The fix is best-effort and time-boxed: an arrival with no coordinates
        // still counts, and waiting on a GPS lock that is not coming does not.
        const fix = await currentPosition();
        await run('arrived', fix ?? {});
      },
      start: () => run('status', { superStatus: JobSuperStatus.IN_PROGRESS }),
      finish: () => run('status', { superStatus: JobSuperStatus.DONE }),
      addNote: (note) => run('note', { note }),
    }),
    [run],
  );
}
