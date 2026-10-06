import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardBundle, useRangeWidget } from "./hooks";

const api = vi.hoisted(() => ({
  getDealBundle: vi.fn(),
  getCallsBundle: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

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

  // Another "Last N Days" keeps the card's chart up until the new one is in:
  // a card that blanked to its skeleton shrank, and every card under it moved.
  it("a new range keeps the current answer on screen until its own arrives", async () => {
    let answerSecond: (v: unknown) => void = () => {};
    const fetch = vi.fn((w: { from: string }) =>
      w.from === "2026-09-14" ? Promise.resolve({ days: 14 }) : new Promise((r) => (answerSecond = r)),
    );
    const { Wrapper } = wrapper();
    const { result, rerender } = renderHook(({ range }: { range: 7 | 14 }) => useRangeWidget("top-sources", fetch, range, now), {
      wrapper: Wrapper,
      initialProps: { range: 14 },
    });
    await waitFor(() => expect(result.current.data).toEqual({ days: 14 }));

    rerender({ range: 7 });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(result.current.data).toEqual({ days: 14 });
    expect(result.current.isLoading).toBe(false);

    act(() => answerSecond({ days: 7 }));
    await waitFor(() => expect(result.current.data).toEqual({ days: 7 }));
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

/**
 * Пакет при відкритті дашборда: два запити замість одинадцяти, і відповідь
 * розкладається в кеш кожної картки — тож картки заповнюються разом.
 */
describe("useDashboardBundle", () => {
  const window30 = { from: "2026-08-29", to: "2026-09-28" };

  it("asks each service once for the opening window and today", async () => {
    api.getDealBundle.mockResolvedValue({});
    api.getCallsBundle.mockResolvedValue({});
    const { Wrapper } = wrapper();

    renderHook(() => useDashboardBundle(now), { wrapper: Wrapper });

    await waitFor(() => expect(api.getDealBundle).toHaveBeenCalledWith(window30, "2026-09-28"));
    expect(api.getCallsBundle).toHaveBeenCalledWith(window30);
  });

  it("puts every widget in its card's own cache entry", async () => {
    const topSources = { slices: [{ key: "s", name: "S", count: 1, percent: 100 }] };
    const jobsNow = { byStatus: { submitted: 1, pending: 0, in_progress: 0, done_pending_approval: 0 } };
    const today = { jobsDone: 1, jobsCanceled: 0, jobsCreated: 2 };
    const jobsByStatus = { days: [], atLeast: false };
    const topCallFlows = { days: [], flows: [], atLeast: false };
    const recentCalls = [{ callSid: "CA1" }];
    api.getDealBundle.mockResolvedValue({ topSources, jobsNow, today, jobsByStatus });
    api.getCallsBundle.mockResolvedValue({ topCallFlows, recentCalls });
    const { client, Wrapper } = wrapper();

    const { result } = renderHook(() => useDashboardBundle(now), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(client.getQueryData(queryKeys.dashboard.widget("top-sources", window30))).toEqual(topSources);
    expect(client.getQueryData(queryKeys.dashboard.widget("jobs-now"))).toEqual(jobsNow);
    expect(client.getQueryData(queryKeys.dashboard.widget("today", "2026-09-28"))).toEqual(today);
    expect(client.getQueryData(queryKeys.dashboard.jobsByStatus(window30))).toEqual(jobsByStatus);
    expect(client.getQueryData(queryKeys.dashboard.widget("top-call-flows", window30))).toEqual(topCallFlows);
    expect(client.getQueryData(queryKeys.dashboard.widget("recent-calls"))).toEqual(recentCalls);
    // A widget the role does not hold is not seeded as anything.
    expect(client.getQueryData(queryKeys.dashboard.widget("sales", window30))).toBeUndefined();
  });

  it("one service failing does not hold back the other's widgets", async () => {
    api.getDealBundle.mockRejectedValue(new Error("502"));
    api.getCallsBundle.mockResolvedValue({ recentCalls: [] });
    const { client, Wrapper } = wrapper();

    const { result } = renderHook(() => useDashboardBundle(now), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(client.getQueryData(queryKeys.dashboard.widget("recent-calls"))).toEqual([]);
  });
});
