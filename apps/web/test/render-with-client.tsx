import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Render with a fresh, retry-less QueryClient (and the tooltip provider). */
export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper }) };
}
