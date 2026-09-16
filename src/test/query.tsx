import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProviders } from './render';

/**
 * A query client for a test: no retries (a test asserting a failure should not
 * wait out a backoff) and no garbage-collection delay between cases.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function withQuery(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AppProviders>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AppProviders>
    );
  };
}
