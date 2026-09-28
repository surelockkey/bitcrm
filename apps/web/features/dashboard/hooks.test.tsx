import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRangeWidget } from "./hooks";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

const now = new Date("2026-09-28T12:00:00.000Z");

/**
 * Віджет читає нічний знімок; кнопка ↻ просить сервер побудувати його заново.
 * А повернення на дашборд бере відповідь із пам'яті браузера, а не з мережі.
 */
describe("useRangeWidget", () => {
  it("reads the snapshot for the New York window", async () => {
    const fetch = vi.fn(async () => ({ slices: [] }));
    const { Wrapper } = wrapper();

    renderHook(() => useRangeWidget("top-sources", fetch, 14, now), { wrapper: Wrapper });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith({ from: "2026-09-14", to: "2026-09-28" }, undefined));
  });

  it("refresh asks the server to rebuild, and the rebuilt answer replaces the cached one", async () => {
    const fetch = vi.fn(async (_w: unknown, opts?: { refresh?: boolean }) => ({ rebuilt: Boolean(opts?.refresh) }));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRangeWidget("top-sources", fetch, 14, now), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ rebuilt: false }));

    await act(async () => {
      await result.current.refetch();
    });

    expect(fetch).toHaveBeenLastCalledWith({ from: "2026-09-14", to: "2026-09-28" }, { refresh: true });
    expect(result.current.data).toEqual({ rebuilt: true });
  });

  it("a remount within minutes is served from memory, not the network", async () => {
    const fetch = vi.fn(async () => ({ slices: [] }));
    const { Wrapper } = wrapper();
    const first = renderHook(() => useRangeWidget("top-sources", fetch, 14, now), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();

    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.now() + 2 * 60_000 });
    const again = renderHook(() => useRangeWidget("top-sources", fetch, 14, now), { wrapper: Wrapper });
    expect(again.result.current.data).toEqual({ slices: [] });
    vi.useRealTimers();

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
