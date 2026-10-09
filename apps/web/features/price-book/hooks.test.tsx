import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import type { ProductFilter } from "@/features/inventory/products/lib";
import {
  useCategoryItemCounts,
  useCreateCatalogEntry,
  usePriceBookCount,
  usePriceBookItems,
  useUpdateCatalogEntry,
} from "./hooks";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const everyFilter: ProductFilter = {
  search: "dead",
  type: ProductType.SERVICE,
  category: "Locks",
  brandId: "b1",
  status: InventoryStatus.ARCHIVED,
  manageStock: false,
};

describe("usePriceBookItems", () => {
  it("asks the server for one page under every filter, and nothing else", async () => {
    const seen: Record<string, string>[] = [];
    server.use(
      http.get("*/inventory/products", ({ request }) => {
        seen.push(Object.fromEntries(new URL(request.url).searchParams));
        return HttpResponse.json({ success: true, data: [], pagination: {} });
      }),
    );
    const { result } = renderHook(() => usePriceBookItems(everyFilter, 25), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual([
      {
        search: "dead",
        type: "service",
        category: "Locks",
        brandId: "b1",
        status: "archived",
        manageStock: "false",
        limit: "25",
      },
    ]);
  });

  it("files the page under the products list key, so an item saved in the popup refreshes it", async () => {
    server.use(
      http.get("*/inventory/products", () =>
        HttpResponse.json({ success: true, data: [{ id: "p1" }], pagination: {} }),
      ),
    );
    const client = newClient();
    const { result } = renderHook(() => usePriceBookItems({ status: InventoryStatus.ACTIVE }, 50), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const key = queryKeys.inventory.products.list({ status: InventoryStatus.ACTIVE, limit: 50 });
    expect(client.getQueryData(key)).toBeDefined();
    expect(key[0]).toBe(queryKeys.inventory.products.all()[0]);
  });

  it("keeps the previous rows on screen while a new filter loads", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get("*/inventory/products", async ({ request }) => {
        const search = new URL(request.url).searchParams.get("search");
        if (search) await gate;
        return HttpResponse.json({
          success: true,
          data: [{ id: search ? "p2" : "p1" }],
          pagination: {},
        });
      }),
    );
    const { result, rerender } = renderHook(({ f }) => usePriceBookItems(f, 50), {
      wrapper: wrapper(newClient()),
      initialProps: { f: {} as ProductFilter },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ f: { search: "x" } });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.pages[0].data).toEqual([{ id: "p1" }]);

    await act(async () => release());
    await waitFor(() => expect(result.current.data?.pages[0].data).toEqual([{ id: "p2" }]));
  });
});

describe("usePriceBookCount", () => {
  it("counts under the same filters the list uses", async () => {
    const seen: Record<string, string>[] = [];
    server.use(
      http.get("*/inventory/products/count", ({ request }) => {
        seen.push(Object.fromEntries(new URL(request.url).searchParams));
        return HttpResponse.json({ success: true, data: { total: 3, atLeast: false } });
      }),
    );
    const { result } = renderHook(() => usePriceBookCount(everyFilter), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual({ total: 3, atLeast: false }));
    expect(seen).toEqual([
      {
        search: "dead",
        type: "service",
        category: "Locks",
        brandId: "b1",
        status: "archived",
        manageStock: "false",
      },
    ]);
  });
});

/** Workiz's "No. of active items" beside each category: one count per category, under the same key the list's count uses. */
describe("useCategoryItemCounts", () => {
  it("counts the active items filed under each category, and answers with them all at once", async () => {
    const seen: string[] = [];
    server.use(
      http.get("*/inventory/products/count", ({ request }) => {
        const q = new URL(request.url).searchParams;
        seen.push(`${q.get("category")}|${q.get("status")}`);
        return HttpResponse.json({ success: true, data: { total: q.get("category") === "Locks" ? 349 : 1, atLeast: false } });
      }),
    );
    const client = newClient();
    const { result } = renderHook(() => useCategoryItemCounts(["Locks", "A > B"], true), { wrapper: wrapper(client) });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect([...result.current.counts]).toEqual([
      ["Locks", 349],
      ["A > B", 1],
    ]);
    expect(seen.sort()).toEqual(["A > B|active", "Locks|active"]);
    expect(client.getQueryData(queryKeys.inventory.products.count({ category: "Locks", status: "active" }))).toEqual({
      total: 349,
      atLeast: false,
    });
  });

  it("asks nothing when not allowed, and is not loading then", () => {
    const { result } = renderHook(() => useCategoryItemCounts(["Locks"], false), { wrapper: wrapper(newClient()) });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.counts.size).toBe(0);
  });
});

describe("renaming a category", () => {
  it("refreshes the items too — the server moves the items filed under the old name", async () => {
    server.use(
      http.put("*/inventory/categories/:id", () =>
        HttpResponse.json({ success: true, data: { id: "c1", name: "Door Locks", active: true, movedItems: 3 } }),
      ),
    );
    const client = newClient();
    const items = queryKeys.inventory.products.list({ status: "active", limit: 10 });
    client.setQueryData(items, { pages: [], pageParams: [] });
    const { result } = renderHook(() => useUpdateCatalogEntry("categories"), { wrapper: wrapper(client) });
    await act(() => result.current.mutateAsync({ id: "c1", body: { name: "Door Locks" } }));
    expect(client.getQueryState(items)?.isInvalidated).toBe(true);
  });

  it("leaves the items alone when only the switch or the description changed", async () => {
    server.use(
      http.put("*/inventory/categories/:id", () =>
        HttpResponse.json({ success: true, data: { id: "c1", name: "Locks", active: false } }),
      ),
    );
    const client = newClient();
    const items = queryKeys.inventory.products.list({ status: "active", limit: 10 });
    client.setQueryData(items, { pages: [], pageParams: [] });
    const { result } = renderHook(() => useUpdateCatalogEntry("categories"), { wrapper: wrapper(client) });
    await act(() => result.current.mutateAsync({ id: "c1", body: { active: false, description: "x" } }));
    expect(client.getQueryState(items)?.isInvalidated).toBe(false);
  });
});

describe("catalog writes", () => {
  const row = { id: "c1", name: "Locks", active: true, createdBy: "", createdAt: "", updatedAt: "" };

  it.each([
    ["categories", "/inventory/categories", queryKeys.inventory.categories.list()],
    ["brands", "/inventory/brands", queryKeys.inventory.brands.list()],
  ] as const)("creates a %s row and refreshes that catalog", async (kind, path, listKey) => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`*${path}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ success: true, data: row });
      }),
    );
    const client = newClient();
    client.setQueryData(listKey, []);
    const { result } = renderHook(() => useCreateCatalogEntry(kind), { wrapper: wrapper(client) });
    await act(() => result.current.mutateAsync({ name: "Locks", active: true, description: "Cylinders" }));
    expect(bodies).toEqual([{ name: "Locks", active: true, description: "Cylinders" }]);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it.each([
    ["categories", "/inventory/categories", queryKeys.inventory.categories.list()],
    ["brands", "/inventory/brands", queryKeys.inventory.brands.list()],
  ] as const)("updates a %s row by id and refreshes that catalog", async (kind, path, listKey) => {
    const calls: { id: string; body: unknown }[] = [];
    server.use(
      http.put(`*${path}/:id`, async ({ request, params }) => {
        calls.push({ id: params.id as string, body: await request.json() });
        return HttpResponse.json({ success: true, data: row });
      }),
    );
    const client = newClient();
    client.setQueryData(listKey, []);
    const { result } = renderHook(() => useUpdateCatalogEntry(kind), { wrapper: wrapper(client) });
    await act(() => result.current.mutateAsync({ id: "c1", body: { active: false } }));
    expect(calls).toEqual([{ id: "c1", body: { active: false } }]);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });
});
