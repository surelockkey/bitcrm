import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useProducts, useProductsCount } from "./products/hooks";
import { useWarehousesCount, useWarehousesList } from "./warehouses/hooks";
import { useContainersCount, useContainersList } from "./containers/hooks";
import { useTransfers, useTransfersCount } from "./transfers/hooks";

/**
 * Every Inventory list pages on the server, and every search keystroke, status
 * or "Rows per page" is a new query key. Without `keepPreviousData` each one
 * starts empty: the 50-row table collapsed to a skeleton and back, the page
 * lost 2 000 px of height, and the pagination bar blinked out. The previous
 * rows — and the previous count — stay until the new ones land.
 */
type Filter = { search?: string };
type Hooks = (filter: Filter, limit: number) => {
  list: { data?: { pages: { data: { id: string }[] }[] }; isPlaceholderData: boolean; isSuccess: boolean };
  count: { data?: { total: number | null }; isPlaceholderData: boolean; isSuccess: boolean };
};

const CASES: { name: string; path: string; useHooks: Hooks }[] = [
  {
    name: "items",
    path: "*/inventory/products",
    useHooks: (f, n) => ({ list: useProducts(f, n), count: useProductsCount(f) }),
  },
  {
    name: "warehouses",
    path: "*/inventory/warehouses",
    useHooks: (f, n) => ({ list: useWarehousesList(f, n), count: useWarehousesCount(f) }),
  },
  {
    name: "containers",
    path: "*/inventory/containers",
    useHooks: (f, n) => ({ list: useContainersList(f, n), count: useContainersCount(f) }),
  },
  {
    name: "transfers",
    path: "*/inventory/transfers",
    // Transfers filter by type, not search; the key changes all the same.
    useHooks: (f, n) => ({
      list: useTransfers(f as never, n),
      count: useTransfersCount(f as never),
    }),
  },
];

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe.each(CASES)("$name list — the previous rows stay while the next set loads", ({ path, useHooks }) => {
  it("holds the old page and count on screen under a new filter, marked as a placeholder", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    server.use(
      http.get(path, async () => {
        if (!first) await gate;
        first = false;
        return HttpResponse.json({ success: true, data: [{ id: "old-1" }], pagination: {} });
      }),
      http.get(`${path}/count`, async ({ request }) => {
        const q = new URL(request.url).searchParams;
        if (q.get("search") || q.get("type")) await gate;
        return HttpResponse.json({ success: true, data: { total: 312, atLeast: false } });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(({ filter, limit }: { filter: Filter; limit: number }) => useHooks(filter, limit), {
      wrapper: wrapper(client),
      initialProps: { filter: {}, limit: 50 },
    });
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.count.isSuccess).toBe(true);
    });

    rerender({ filter: { search: "dead", type: "receive" } as Filter, limit: 50 });

    // The new set is in flight: the old one is still there, flagged.
    expect(result.current.list.data?.pages[0].data).toEqual([{ id: "old-1" }]);
    expect(result.current.list.isPlaceholderData).toBe(true);
    expect(result.current.count.data?.total).toBe(312);
    expect(result.current.count.isPlaceholderData).toBe(true);
    release();
    await waitFor(() => expect(result.current.list.isPlaceholderData).toBe(false));
  });

  it("holds the old page under a new page size too", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get(path, async ({ request }) => {
        if (new URL(request.url).searchParams.get("limit") === "100") await gate;
        return HttpResponse.json({ success: true, data: [{ id: "a" }], pagination: {} });
      }),
      http.get(`${path}/count`, () => HttpResponse.json({ success: true, data: { total: 1, atLeast: false } })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(({ filter, limit }: { filter: Filter; limit: number }) => useHooks(filter, limit), {
      wrapper: wrapper(client),
      initialProps: { filter: {}, limit: 50 },
    });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    rerender({ filter: {}, limit: 100 });

    expect(result.current.list.data?.pages[0].data).toEqual([{ id: "a" }]);
    expect(result.current.list.isPlaceholderData).toBe(true);
    release();
    await waitFor(() => expect(result.current.list.isPlaceholderData).toBe(false));
  });

  // Switching tabs and back within half a minute: the table is already in hand.
  it("does not read the list again on a quick return to the tab", async () => {
    let lists = 0;
    server.use(
      http.get(path, () => {
        lists += 1;
        return HttpResponse.json({ success: true, data: [{ id: "a" }], pagination: {} });
      }),
      http.get(`${path}/count`, () => HttpResponse.json({ success: true, data: { total: 1, atLeast: false } })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderHook(() => useHooks({}, 50), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.list.isSuccess).toBe(true));
    first.unmount();

    const again = renderHook(() => useHooks({}, 50), { wrapper: wrapper(client) });
    await waitFor(() => expect(again.result.current.list.isSuccess).toBe(true));
    expect(lists).toBe(1);
  });
});
