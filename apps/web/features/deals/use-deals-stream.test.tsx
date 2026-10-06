import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const opened = vi.hoisted(() => ({ opts: null as null | { onConnect?: () => void } }));
vi.mock("@/lib/shared-sse-stream", () => ({
  openSharedSseStream: (_name: string, opts: { onConnect?: () => void }) => {
    opened.opts = opts;
    return { close: () => {} };
  },
}));

const { useDealsStream } = await import("./use-deals-stream");

describe("useDealsStream — connecting", () => {
  let qc: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  beforeEach(() => {
    qc = new QueryClient();
    opened.opts = null;
  });

  it("asks for nothing again on the first connect — the page just asked", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useDealsStream(true), { wrapper });
    opened.opts!.onConnect!();
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes the jobs after a reconnect, when frames may have been missed", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useDealsStream(true), { wrapper });
    opened.opts!.onConnect!();
    opened.opts!.onConnect!();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["deals"] });
  });
});
