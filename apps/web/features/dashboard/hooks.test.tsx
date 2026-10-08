import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardBundle, useRangeWidget } from "./hooks";

const api = vi.hoisted(() => ({
  getDealBundle: vi.fn(),
  getCallsBundle: vi.fn(),
  getInvoicesWidget: vi.fn(),
  getEstimatesWidget: vi.fn(),
  getComingUp: vi.fn(),
  getRecentActivity: vi.fn(),
  getCollectedToday: vi.fn(),
  nameScoreboards: vi.fn(async (b: unknown[]) => b),
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
const window14 = { from: "2026-09-14", to: "2026-09-28" };

/**
 * Віджет читає нічний знімок; кнопка ↻ просить сервер побудувати його заново.
 * А повернення на дашборд бере відповідь із пам'яті браузера, а не з мережі.
 */
describe("useRangeWidget", () => {
  it("reads the snapshot for the New York window", async () => {
    const fetch = vi.fn(async () => ({ slices: [] }));
    const { Wrapper } = wrapper();

    renderHook(() => useRangeWidget("top-sources", fetch, window14), { wrapper: Wrapper });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith({ from: "2026-09-14", to: "2026-09-28" }, undefined));
  });

  it("refresh asks the server to rebuild, and the rebuilt answer replaces the cached one", async () => {
    const fetch = vi.fn(async (_w: unknown, opts?: { refresh?: boolean }) => ({ rebuilt: Boolean(opts?.refresh) }));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useRangeWidget("top-sources", fetch, window14), { wrapper: Wrapper });
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
    const week = { from: "2026-09-28", to: "2026-09-28" };
    const { result, rerender } = renderHook(({ w }: { w: { from: string; to: string } }) => useRangeWidget("top-sources", fetch, w), {
      wrapper: Wrapper,
      initialProps: { w: window14 },
    });
    await waitFor(() => expect(result.current.data).toEqual({ days: 14 }));

    rerender({ w: week });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(result.current.data).toEqual({ days: 14 });
    expect(result.current.isLoading).toBe(false);

    act(() => answerSecond({ days: 7 }));
    await waitFor(() => expect(result.current.data).toEqual({ days: 7 }));
  });

  it("a remount within minutes is served from memory, not the network", async () => {
    const fetch = vi.fn(async () => ({ slices: [] }));
    const { Wrapper } = wrapper();
    const first = renderHook(() => useRangeWidget("top-sources", fetch, window14), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.data).toBeDefined());
    first.unmount();

    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.now() + 2 * 60_000 });
    const again = renderHook(() => useRangeWidget("top-sources", fetch, window14), { wrapper: Wrapper });
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
  // Workiz opens every widget on its "Last 14 days".
  it("asks each service once for the opening window and today", async () => {
    api.getDealBundle.mockResolvedValue({});
    api.getCallsBundle.mockResolvedValue({});
    const { Wrapper } = wrapper();

    renderHook(() => useDashboardBundle(now), { wrapper: Wrapper });

    await waitFor(() => expect(api.getDealBundle).toHaveBeenCalledWith(window14, "2026-09-28"));
    expect(api.getCallsBundle).toHaveBeenCalledWith(window14);
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

    expect(client.getQueryData(queryKeys.dashboard.widget("top-sources", window14))).toEqual(topSources);
    expect(client.getQueryData(queryKeys.dashboard.widget("jobs-now"))).toEqual(jobsNow);
    expect(client.getQueryData(queryKeys.dashboard.widget("today", "2026-09-28"))).toEqual(today);
    expect(client.getQueryData(queryKeys.dashboard.jobsByStatus(window14))).toEqual(jobsByStatus);
    expect(client.getQueryData(queryKeys.dashboard.widget("top-call-flows", window14))).toEqual(topCallFlows);
    expect(client.getQueryData(queryKeys.dashboard.widget("recent-calls"))).toEqual(recentCalls);
    // A widget the role does not hold is not seeded as anything.
    expect(client.getQueryData(queryKeys.dashboard.widget("sales", window14))).toBeUndefined();
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

/**
 * The widgets read from billing, the schedule and the activity log open in
 * the same gate as the rest: the bundle fetches them too — each only when the
 * page says the reader may see it — and lays each into its card's entry.
 */
describe("useDashboardBundle — the widgets beyond the two services", () => {
  const day = "2026-09-28";

  it("fetches what it is told to, and seeds each card", async () => {
    api.getDealBundle.mockResolvedValue({});
    api.getCallsBundle.mockResolvedValue({});
    const invoices = { due: { count: 2, amount: 50 }, overdue: { count: 1, amount: 20 } };
    const estimates = { unsent: { count: 1, amount: 9 } };
    const coming = { deals: [], clients: {} };
    const activity = [{ id: "a1" }];
    api.getInvoicesWidget.mockResolvedValue(invoices);
    api.getEstimatesWidget.mockResolvedValue(estimates);
    api.getComingUp.mockResolvedValue(coming);
    api.getRecentActivity.mockResolvedValue(activity);
    api.getCollectedToday.mockResolvedValue(12.5);
    const { client, Wrapper } = wrapper();

    const include = { invoices: true, estimates: true, comingUp: true, recentActivity: true, collected: true };
    const { result } = renderHook(() => useDashboardBundle(now, include), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(api.getInvoicesWidget).toHaveBeenCalledWith(undefined);
    expect(api.getComingUp).toHaveBeenCalledWith(day);
    expect(client.getQueryData(queryKeys.dashboard.widget("invoices", "all_time"))).toEqual(invoices);
    expect(client.getQueryData(queryKeys.dashboard.widget("estimates"))).toEqual(estimates);
    expect(client.getQueryData(queryKeys.dashboard.widget("coming-up", day))).toEqual(coming);
    expect(client.getQueryData(queryKeys.dashboard.widget("recent-activity", day))).toEqual(activity);
    expect(client.getQueryData(queryKeys.dashboard.widget("collected", day))).toBe(12.5);
  });

  it("asks nothing of a widget the reader may not see", async () => {
    api.getDealBundle.mockResolvedValue({});
    api.getCallsBundle.mockResolvedValue({});
    for (const fn of [api.getInvoicesWidget, api.getEstimatesWidget, api.getComingUp, api.getRecentActivity, api.getCollectedToday]) {
      fn.mockClear();
    }
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useDashboardBundle(now, { invoices: false }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(api.getInvoicesWidget).not.toHaveBeenCalled();
    expect(api.getEstimatesWidget).not.toHaveBeenCalled();
    expect(api.getComingUp).not.toHaveBeenCalled();
    expect(api.getRecentActivity).not.toHaveBeenCalled();
    expect(api.getCollectedToday).not.toHaveBeenCalled();
  });

  it("names the scoreboards before they are seeded", async () => {
    const board = { rows: [{ id: "u1", name: "", jobs: 1 }] };
    const named = { rows: [{ id: "u1", name: "(2) TX - DAVID SZENDER", jobs: 1 }] };
    api.getDealBundle.mockResolvedValue({ techScoreboard: board });
    api.getCallsBundle.mockResolvedValue({});
    api.nameScoreboards.mockResolvedValueOnce([named, undefined]);
    const { client, Wrapper } = wrapper();

    const { result } = renderHook(() => useDashboardBundle(now), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(client.getQueryData(queryKeys.dashboard.widget("tech-scoreboard", window14))).toEqual(named);
  });
});
