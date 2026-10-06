import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const opened = vi.hoisted(() => ({ opts: null as null | { onConnect?: () => void } }));
vi.mock("./stream", () => ({
  openMessagingStream: (opts: { onConnect?: () => void }) => {
    opened.opts = opts;
    return { close: () => {} };
  },
}));
vi.mock("@/features/auth/use-me", () => ({ useMe: () => ({ data: { id: "u1" } }) }));

const { useMessagingStream } = await import("./use-messaging-stream");

describe("useMessagingStream — connecting", () => {
  let qc: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  beforeEach(() => {
    qc = new QueryClient();
    opened.opts = null;
  });

  it("asks for nothing again on the first connect — the page just asked", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useMessagingStream(true), { wrapper });
    opened.opts!.onConnect!();
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes after a reconnect, when frames may have been missed", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useMessagingStream(true), { wrapper });
    opened.opts!.onConnect!();
    opened.opts!.onConnect!();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
