import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import type { ContainerFilter } from "./api";
import { useContainerStockView, useContainersCount, useContainersList } from "./hooks";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

/** Every query string the list and the count endpoints were asked with. */
function captureRequests() {
  const lists: Record<string, string>[] = [];
  const counts: Record<string, string>[] = [];
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
  server.use(
    http.get("*/inventory/containers", ({ request }) => {
      lists.push(params(request.url));
      return HttpResponse.json({ success: true, data: [], pagination: {} });
    }),
    http.get("*/inventory/containers/count", ({ request }) => {
      counts.push(params(request.url));
      return HttpResponse.json({ success: true, data: { total: 0, atLeast: false } });
    }),
  );
  return { lists, counts };
}

// The fleet's pages are cut on the server after filtering — a filter that
// never reaches it, or a cache key without it, brings back the old
// "different number on every page".
describe("fleet list + count hooks", () => {
  it("send the filter to the server, and a new filter is a new request", async () => {
    const { lists, counts } = captureRequests();
    const client = new QueryClient();
    const { result, rerender } = renderHook(
      ({ filter }: { filter: ContainerFilter }) => ({
        list: useContainersList(filter, 25),
        count: useContainersCount(filter),
      }),
      {
        wrapper: wrapper(client),
        initialProps: {
          filter: { search: "van", department: "North", status: InventoryStatus.ACTIVE },
        },
      },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.count.isSuccess).toBe(true);
    });
    expect(lists).toEqual([{ search: "van", department: "North", status: "active", limit: "25" }]);
    expect(counts).toEqual([{ search: "van", department: "North", status: "active" }]);

    rerender({ filter: { search: "van", department: "South", status: InventoryStatus.ACTIVE } });
    await waitFor(() => {
      expect(lists).toHaveLength(2);
      expect(counts).toHaveLength(2);
    });
    expect(lists[1]).toEqual({ search: "van", department: "South", status: "active", limit: "25" });
    expect(counts[1]).toEqual({ search: "van", department: "South", status: "active" });
  });
});

/**
 * The van's stock is one request now, named and priced on the server —
 * never the whole stock-managed catalog (3 102 items, 32 sequential requests).
 */
describe("useContainerStockView", () => {
  it("reads GET /stock/locations/container/:id and nothing else", async () => {
    const urls: string[] = [];
    server.events.on("request:start", ({ request }) => {
      urls.push(new URL(request.url).pathname.replace(/^.*\/inventory/, "/inventory"));
    });
    server.use(
      http.get("*/inventory/stock/locations/container/c1", () =>
        HttpResponse.json({
          success: true,
          data: {
            locationType: "container",
            locationId: "c1",
            name: "Main",
            status: InventoryStatus.ACTIVE,
            rows: [{ productId: "p1", productName: "Deadbolt", quantity: 6, priceClient: 45 }],
          },
        }),
      ),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useContainerStockView("c1"), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    server.events.removeAllListeners();

    expect(urls).toEqual(["/inventory/stock/locations/container/c1"]);
    expect(result.current.rows.map((r) => [r.name, r.quantity])).toEqual([["Deadbolt", 6]]);
    expect(result.current.summary).toMatchObject({ skuCount: 1, totalUnits: 6, totalValue: 270 });
  });
});
