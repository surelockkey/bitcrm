import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import type { WarehouseFilter } from "./api";
import { useProductMap, useWarehousesCount, useWarehousesList } from "./hooks";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("useProductMap", () => {
  it("keeps its own cache — the job's item picker stores the whole catalog as a list", async () => {
    server.use(
      http.get("*/inventory/products", () =>
        HttpResponse.json({ success: true, data: [{ id: "p1", name: "Deadbolt" }], pagination: {} }),
      ),
    );
    const client = new QueryClient();
    // What the Add item dialog leaves behind: an array, services included.
    client.setQueryData(queryKeys.inventory.products.map(), [{ id: "s1", name: "Call-out" }]);

    const { result } = renderHook(() => useProductMap(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeInstanceOf(Map);
    expect(result.current.data?.get("p1")?.name).toBe("Deadbolt");
  });
});

// Warehouses are filtered on the server before the page is cut — a filter
// that never reaches it, or a cache key without it, shows the wrong page.
describe("warehouses list + count hooks", () => {
  it("send the filter to the server, and a new filter is a new request", async () => {
    const lists: Record<string, string>[] = [];
    const counts: Record<string, string>[] = [];
    const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
    server.use(
      http.get("*/inventory/warehouses", ({ request }) => {
        lists.push(params(request.url));
        return HttpResponse.json({ success: true, data: [], pagination: {} });
      }),
      http.get("*/inventory/warehouses/count", ({ request }) => {
        counts.push(params(request.url));
        return HttpResponse.json({ success: true, data: { total: 0, atLeast: false } });
      }),
    );
    const client = new QueryClient();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: WarehouseFilter }) => ({
        list: useWarehousesList(filter, 25),
        count: useWarehousesCount(filter),
      }),
      {
        wrapper: wrapper(client),
        initialProps: { filter: { search: "dal", status: InventoryStatus.ACTIVE } },
      },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.count.isSuccess).toBe(true);
    });
    expect(lists).toEqual([{ search: "dal", status: "active", limit: "25" }]);
    expect(counts).toEqual([{ search: "dal", status: "active" }]);

    rerender({ filter: { search: "dal", status: InventoryStatus.ARCHIVED } });
    await waitFor(() => {
      expect(lists).toHaveLength(2);
      expect(counts).toHaveLength(2);
    });
    expect(lists[1]).toEqual({ search: "dal", status: "archived", limit: "25" });
    expect(counts[1]).toEqual({ search: "dal", status: "archived" });
  });
});
