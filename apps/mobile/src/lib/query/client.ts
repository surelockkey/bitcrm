import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { backoffDelayMs, shouldRetryQuery } from '../api/retry';
import {
  MAX_PERSISTED_AGE_MS,
  PERSISTED_CACHE_BUSTER,
  PERSISTED_CACHE_KEY,
} from './persist';

/**
 * One client for the whole app.
 *
 * A singleton rather than a provider-scoped instance because sign-out has to
 * be able to wipe it (the next technician on a shared phone must not see the
 * last one's route), and the outbox worker — which is not a React component —
 * has to invalidate keys when a queued write finally lands.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * A minute of "fresh": long enough that moving between the list and a job
       * does not re-fetch on every tap, short enough that a job dispatch moved
       * while the phone was in a pocket shows up on the next look.
       */
      staleTime: 60_000,
      /** A day in cache, so re-opening the app has something to paint at once. */
      gcTime: 24 * 60 * 60 * 1000,
      retry: shouldRetryQuery,
      retryDelay: (attempt) => backoffDelayMs(attempt + 1),
      /** The technician pulls to refresh; a focus change is not a reason to. */
      refetchOnWindowFocus: false,
      /** Reconnecting IS a reason to — it usually means leaving a basement. */
      refetchOnReconnect: true,
    },
    mutations: {
      // Writes are never retried here: they go through the durable outbox,
      // which owns retrying and is visible to the technician while it does.
      retry: false,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: PERSISTED_CACHE_KEY,
  // Batch the writes: a list of 80 jobs is not re-serialised per keystroke.
  throttleTime: 2_000,
});

/**
 * Forget everything about the person who was signed in — in memory and on
 * disk. A van's phone gets handed over, and the next technician must not open
 * the app to someone else's addresses.
 */
export async function resetAppCache(): Promise<void> {
  queryClient.clear();
  try {
    await persister.removeClient();
  } catch {
    // A keychain/storage failure must not block signing out.
  }
}

export const persistOptions = {
  persister,
  maxAge: MAX_PERSISTED_AGE_MS,
  buster: PERSISTED_CACHE_BUSTER,
};
