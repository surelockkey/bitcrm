import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/api/query-keys';
import { useAuth } from '../auth/auth-context';
import { getMe } from '../auth/api';
import { saveProfile } from '../auth/profile-store';
import type { AuthUser } from '../auth/types';
import { fetchAllDeals, getDeal, markDealSeen } from './api';
import { groupJobsByDay, localDateIso } from './lib';
import { applyPatchToList } from './optimistic';
import type { Deal } from './types';

/**
 * The signed-in technician.
 *
 * Seeded from the session that was already restored (from the network, or from
 * disk when the app opened with no signal), then re-fetched in the background:
 * `initialDataUpdatedAt: 0` marks the seed as infinitely stale, so the screen
 * paints immediately and the profile still refreshes the moment there is a
 * connection.
 */
export function useMe() {
  const { state } = useAuth();
  const seed = state.status === 'signedIn' ? state.user : undefined;

  return useQuery<AuthUser>({
    queryKey: queryKeys.me(),
    queryFn: async () => {
      const user = await getMe();
      void saveProfile(user);
      return user;
    },
    enabled: Boolean(seed),
    initialData: seed,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
  });
}

export interface UseMyJobsResult {
  groups: ReturnType<typeof groupJobsByDay>;
  deals: Deal[];
  techId: string | undefined;
  /** False until the technician's own id is known — "loading", not "empty". */
  ready: boolean;
  isLoading: boolean;
  isRefetching: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * The technician's own jobs, grouped into the day list they work from.
 *
 * `techId` is sent explicitly and waited for. The server only *defaults* it to
 * the caller under the `assigned_only` data scope (deals.service.ts:441-443),
 * so a dispatcher opening this screen without it would pull the entire board
 * onto a phone (docs/ARCHITECTURE.md §1.2).
 */
export function useMyJobs(todayIso: string = localDateIso()): UseMyJobsResult {
  const { data: me } = useMe();
  const techId = me?.id;

  const query = useQuery<Deal[]>({
    queryKey: queryKeys.deals.list({ techId }),
    queryFn: () => fetchAllDeals({ techId }),
    enabled: Boolean(techId),
  });

  const deals = query.data ?? [];
  const groups = useMemo(
    () => groupJobsByDay(deals, todayIso, techId),
    [deals, todayIso, techId],
  );

  return {
    groups,
    deals,
    techId,
    ready: Boolean(techId),
    isLoading: !techId || query.isPending,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/**
 * Find a job among the day lists already in the cache.
 *
 * Opening a job from the list must paint at once — the technician has just
 * looked at that exact row — and underground it is the only copy there is.
 * Pure so the lookup is a test rather than a hope.
 */
export function findDealById(
  lists: readonly (readonly Deal[] | undefined)[],
  id: string,
): Deal | undefined {
  for (const list of lists) {
    const found = list?.find((d) => d.id === id);
    if (found) return found;
  }
  return undefined;
}

function seedFromLists(qc: QueryClient, id: string): Deal | undefined {
  const lists = qc
    .getQueriesData<Deal[]>({ queryKey: queryKeys.deals.lists() })
    .map(([, data]) => data);
  return findDealById(lists, id);
}

/** One job. Painted from the day list while the fresh copy is on its way. */
export function useJob(id: string) {
  const qc = useQueryClient();
  return useQuery<Deal>({
    queryKey: queryKeys.deals.detail(id),
    queryFn: () => getDeal(id),
    initialData: () => seedFromLists(qc, id),
    initialDataUpdatedAt: 0,
  });
}

/**
 * Tell the server the technician has opened this job — Workiz's "Viewed job in
 * app", the web's `useMarkSeenOnOpen` (`apps/web/features/deals/hooks.ts:387`).
 *
 * This is the half of the Sent/Seen pair that has to come from the phone.
 * "Seen" reads `seenByTechAt`, which only `POST /deals/:id/seen` writes, and
 * only an assigned technician's app is in a position to call it — so with
 * nothing calling it, the Seen step could never complete: every card in the
 * day list showed "Seen —" for a job the technician was looking at, and
 * dispatch's own Seen column stayed empty for everyone who works off the
 * phone. Which is the same lie the old stamp told, just in the other
 * direction.
 *
 * Once per mounted job, and only for a technician actually on the roster: the
 * endpoint ignores anyone else, so this is about not spending a request. The
 * answer carries the stamp, so the two cached copies are patched rather than
 * refetched — a full day list is 50 pages at worst, and the technician is
 * standing in front of the job. Silent on failure: nobody opening a job should
 * be shown an error about a receipt they did not ask for.
 */
export function useMarkSeenOnOpen(
  deal: Deal | undefined,
  viewerId: string | undefined,
): void {
  const qc = useQueryClient();
  const marked = useRef<string | null>(null);
  const dealId = deal?.id;
  const assigned = Boolean(
    viewerId && deal?.assignedTechIds?.includes(viewerId),
  );

  useEffect(() => {
    if (!assigned || !dealId || marked.current === dealId) return;
    // Latched before the request, not after: a re-render while it is in flight
    // must not send a second one.
    marked.current = dealId;
    markDealSeen(dealId)
      .then(({ first, seenAt }) => {
        // Only the open that actually stamped the job changes anything.
        if (!first || !seenAt) return;
        const patch: Partial<Deal> = { seenByTechAt: seenAt };
        qc.setQueryData<Deal>(queryKeys.deals.detail(dealId), (prev) =>
          prev ? { ...prev, ...patch } : prev,
        );
        qc.setQueriesData<Deal[]>({ queryKey: queryKeys.deals.lists() }, (list) =>
          applyPatchToList(list, dealId, patch),
        );
      })
      .catch(() => undefined);
  }, [assigned, dealId, qc]);
}
