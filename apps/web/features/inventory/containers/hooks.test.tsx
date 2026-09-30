import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import type { ContainerFilter } from "./api";
import { queryKeys } from "@/lib/query-keys";
import {
  useContainerStockView,
  useContainersCount,
  useContainersList,
  usePrefetchVanStock,
  useUpdateContainer,
} from "./hooks";

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

/**
 * Saving a van changes its row — the lists, the pickers, the counts, its
 * detail, "my container" — and none of the stock under the `containers` root.
 */
describe("van edits refresh the rows, not the stock", () => {
  it("on save", async () => {
    server.use(
      http.put("*/inventory/containers/c1", () =>
        HttpResponse.json({ success: true, data: { id: "c1", name: "Van 1" } }),
      ),
    );
    const rows = [
      queryKeys.inventory.containers.list({ limit: 50 }),
      queryKeys.inventory.containers.count({}),
      queryKeys.inventory.containers.everything(),
      queryKeys.inventory.containers.detail("c1"),
      queryKeys.inventory.containers.mine(),
    ];
    const stock = [
      queryKeys.inventory.locationStock("container", "c1"),
      queryKeys.inventory.locationStock("container", "c2"),
      queryKeys.inventory.containers.stock("c1"),
      queryKeys.inventory.containers.detail("c2"),
    ];
    const client = new QueryClient();
    for (const key of [...rows, ...stock]) client.setQueryData(key, {});
    const { result } = renderHook(() => useUpdateContainer(), { wrapper: wrapper(client) });

    act(() => result.current.mutate({ id: "c1", body: { name: "Van 1" } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rows.map((k) => client.getQueryState(k)?.isInvalidated)).toEqual(rows.map(() => true));
    expect(stock.map((k) => client.getQueryState(k)?.isInvalidated)).toEqual(stock.map(() => false));
  });
});

/**
 * A van's stock popup opened by link (`?stock=<id>`) waited for the
 * permissions, then for the page, before it asked for the van's stock: three
 * requests in a row. What the popup shows needs no permission to ask for —
 * the server guards it — so it is asked for straight away.
 */
describe("usePrefetchVanStock", () => {
  function captureVan(templateId?: string) {
    const hits: string[] = [];
    server.use(
      http.get("*/inventory/stock/locations/container/:id", ({ params }) => {
        hits.push(`stock ${params.id}`);
        return HttpResponse.json({ success: true, data: { name: "Van 9", status: "active", rows: [] } });
      }),
      http.get("*/inventory/containers/:id", ({ params }) => {
        hits.push(`van ${params.id}`);
        return HttpResponse.json({
          success: true,
          data: { id: params.id, name: "Van 9", status: "active", createdAt: "", updatedAt: "", templateId },
        });
      }),
      http.get("*/inventory/container-templates/:id/diff", ({ params, request }) => {
        hits.push(`diff ${params.id} ${new URL(request.url).searchParams.get("containerId")}`);
        return HttpResponse.json({ success: true, data: { lines: [], shortLineCount: 0, missingUnits: 0 } });
      }),
    );
    return hits;
  }

  it("reads the van's stock, the van and its template comparison, under the keys the popup reads", async () => {
    const hits = captureVan("tp1");
    const client = new QueryClient();
    renderHook(() => usePrefetchVanStock("c9"), { wrapper: wrapper(client) });

    await waitFor(() => expect(hits).toContain("diff tp1 c9"));
    expect(hits).toEqual(expect.arrayContaining(["stock c9", "van c9"]));
    expect(client.getQueryData(queryKeys.inventory.locationStock("container", "c9"))).toMatchObject({ name: "Van 9" });
    expect(client.getQueryData(queryKeys.inventory.containers.detail("c9"))).toMatchObject({ templateId: "tp1" });
    expect(client.getQueryData(queryKeys.inventory.containerTemplates.diff("tp1", "c9", undefined))).toBeDefined();
  });

  it("compares nothing for a van without a template", async () => {
    const hits = captureVan(undefined);
    const client = new QueryClient();
    renderHook(() => usePrefetchVanStock("c9"), { wrapper: wrapper(client) });
    await waitFor(() => expect(client.getQueryData(queryKeys.inventory.containers.detail("c9"))).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    expect(hits.some((h) => h.startsWith("diff"))).toBe(false);
  });

  it("asks for nothing without a van", async () => {
    const hits = captureVan("tp1");
    renderHook(() => usePrefetchVanStock(null), { wrapper: wrapper(new QueryClient()) });
    await new Promise((r) => setTimeout(r, 20));
    expect(hits).toEqual([]);
  });
});
