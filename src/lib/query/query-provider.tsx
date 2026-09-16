import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { startOnlineMonitor } from '../net/online';
import { persistFilter } from './persist';
import { persistOptions, queryClient } from './client';

/**
 * The data layer, wired to the phone.
 *
 * - the cache is restored from disk before the first screen paints, so opening
 *   the app underground shows today's jobs rather than a spinner;
 * - connectivity drives react-query's online state, so a request made with no
 *   signal waits instead of failing;
 * - foregrounding counts as "focus", which is what makes a refetch happen when
 *   the phone comes out of a pocket.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => startOnlineMonitor(), []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) =>
      focusManager.setFocused(status === 'active'),
    );
    return () => sub.remove();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        ...persistOptions,
        dehydrateOptions: { shouldDehydrateQuery: persistFilter },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
