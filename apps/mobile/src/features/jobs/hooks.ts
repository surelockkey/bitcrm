import { useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/api/query-keys';
import { useAuth } from '../auth/auth-context';
import { getMe } from '../auth/api';
import { saveProfile } from '../auth/profile-store';
import type { AuthUser } from '../auth/types';
import { fetchAllDeals, getDeal } from './api';
import { groupJobsByDay, localDateIso } from './lib';
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
