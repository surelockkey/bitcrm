"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  setAuthTokenProvider,
  setSessionRefresher,
  setUnauthorizedHandler,
} from "@/lib/api/http";
import { getIdToken, renewSession, useAuthStore } from "@/stores/auth-store";

// Connect the API client to the auth store exactly once, at module load.
// (Runs on the client only, since this file is a Client Component.)
setAuthTokenProvider(getIdToken);
setSessionRefresher(renewSession);
setUnauthorizedHandler(() => useAuthStore.getState().clear());

// The floating TanStack button covers the corner of the app it sits in, so it
// is asked for (`NEXT_PUBLIC_RQ_DEVTOOLS=1` in `.env.local`), not shown by default.
const showQueryDevtools = process.env.NEXT_PUBLIC_RQ_DEVTOOLS === "1";

// Light only, for now. The Workiz palette in lib/theme/tokens.ts is sampled
// from their screenshots, and they have no dark theme to sample — so there is
// no `.dark` token block, and the ~212 `dark:` utilities still scattered
// through the app would fire against light tokens if the class ever appeared.
// `forcedTheme` keeps that from happening; drop this line and add the block
// when the dark theme is designed.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      forcedTheme="light"
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
        {showQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
