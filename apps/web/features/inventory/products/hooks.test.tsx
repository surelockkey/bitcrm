import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useBrands, useItemCategories, useProductStock } from "./hooks";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const stock = {
  productId: "p1",
  onHand: 369,
  locations: [
    { locationType: "warehouse", locationId: "w1", name: "Main", status: "active", quantity: 360 },
    { locationType: "container", locationId: "c1", name: "Van 1", status: "archived", quantity: 9 },
  ],
};

describe("useProductStock", () => {
  it("reads the item's stock from the one aggregate endpoint", async () => {
    const calls: string[] = [];
    server.use(
      http.get("*/inventory/stock/products/:id", ({ params }) => {
        calls.push(params.id as string);
        return HttpResponse.json({ success: true, data: stock });
      }),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useProductStock("p1", true), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(stock);
    expect(calls).toEqual(["p1"]);
  });

  it("files the answer under the products key, so a stock write refreshes it", async () => {
    server.use(
      http.get("*/inventory/stock/products/:id", () => HttpResponse.json({ success: true, data: stock })),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useProductStock("p1", true), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(queryKeys.inventory.products.stock("p1"))).toEqual(stock);
    expect(queryKeys.inventory.products.stock("p1")[0]).toBe(queryKeys.inventory.products.all()[0]);
  });

  it("asks nothing while disabled (a closed popup)", async () => {
    const client = new QueryClient();
    // No handler: an unexpected request fails the test (onUnhandledRequest: "error").
    const { result } = renderHook(() => useProductStock("p1", false), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("catalog hooks", () => {
  const row = (id: string, name: string, active = true) => ({
    id,
    name,
    active,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
  });

  it("reads the item categories catalog", async () => {
    const categories = [row("cat1", "Locks"), row("cat2", "Old", false)];
    server.use(
      http.get("*/inventory/categories", () => HttpResponse.json({ success: true, data: categories })),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useItemCategories(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(categories);
    expect(client.getQueryData(queryKeys.inventory.categories.list())).toEqual(categories);
  });

  it("reads the brands catalog", async () => {
    const brands = [row("b1", "Schlage"), row("b2", "Kwikset")];
    server.use(http.get("*/inventory/brands", () => HttpResponse.json({ success: true, data: brands })));
    const client = new QueryClient();
    const { result } = renderHook(() => useBrands(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(brands);
    expect(client.getQueryData(queryKeys.inventory.brands.list())).toEqual(brands);
  });

  it("stays quiet for a caller who may not read the catalog", () => {
    const client = new QueryClient();
    const { result } = renderHook(() => [useItemCategories(false), useBrands(false)], {
      wrapper: wrapper(client),
    });
    expect(result.current.map((q) => q.fetchStatus)).toEqual(["idle", "idle"]);
  });
});
