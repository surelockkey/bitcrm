import type { DefaultOptions } from "@tanstack/react-query";

/**
 * How the app's queries behave unless a hook says otherwise — one place, so
 * the tests that keep pages from jumping (`test/page-load.tsx`) run against
 * the same rules as the browser: a page that refetches on mount in a test but
 * not in the app, or the other way round, would make those tests lie.
 */
export const QUERY_DEFAULTS: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
};
