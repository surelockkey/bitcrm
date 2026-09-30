import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import type { WarehouseFilter } from "./api";
import { useWarehouseStockView, useWarehousesCount, useWarehousesList } from "./hooks";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

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

/**
 * The warehouse's stock is one request now, named and priced on the server —
 * never the whole stock-managed catalog (3 102 items, 32 sequential requests).
 */
describe("useWarehouseStockView", () => {
  it("reads GET /stock/locations/warehouse/:id and nothing else", async () => {
    const urls: string[] = [];
    server.events.on("request:start", ({ request }) => {
      urls.push(new URL(request.url).pathname.replace(/^.*\/inventory/, "/inventory"));
    });
    server.use(
      http.get("*/inventory/stock/locations/warehouse/w1", () =>
        HttpResponse.json({
          success: true,
          data: {
            locationType: "warehouse",
            locationId: "w1",
            name: "Main",
            status: InventoryStatus.ACTIVE,
            rows: [{ productId: "p1", productName: "Deadbolt", quantity: 6, priceClient: 45 }],
          },
        }),
      ),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useWarehouseStockView("w1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    server.events.removeAllListeners();

    expect(urls).toEqual(["/inventory/stock/locations/warehouse/w1"]);
    expect(result.current.rows.map((r) => [r.name, r.quantity])).toEqual([["Deadbolt", 6]]);
    expect(result.current.summary).toMatchObject({ skuCount: 1, totalUnits: 6, totalValue: 270 });
  });
});
