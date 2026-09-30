import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useContainer } from "./containers/hooks";
import { useWarehouse } from "./warehouses/hooks";
import { useProduct } from "./products/hooks";

/**
 * A popup opened from a row asks for the row it was opened from. The list
 * already holds it: the popup starts from that row — its title, its template,
 * its form — while the fresh copy is read behind it. Before, each opening was
 * a skeleton (and, for a van's template strip, two requests in a row).
 */
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const page = <T,>(rows: T[]) => ({ pages: [{ data: rows, pagination: {} }], pageParams: [undefined] });

function gated(path: string, row: object) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  server.use(
    http.get(path, async () => {
      await gate;
      return HttpResponse.json({ success: true, data: row });
    }),
  );
  return () => release();
}

describe("details start from the list row already in hand", () => {
  it("a van", async () => {
    const van = { id: "c1", name: "Van 1", templateId: "tp1", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "u1" };
    const release = gated("*/inventory/containers/c1", { ...van, name: "Van 1 (fresh)" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.inventory.containers.list({ limit: 50 }), page([van]));

    const { result } = renderHook(() => useContainer("c1"), { wrapper: wrapper(client) });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.templateId).toBe("tp1");
    release();
    await waitFor(() => expect(result.current.data?.name).toBe("Van 1 (fresh)"));
  });

  it("a van the picker list holds, when no page does", () => {
    const van = { id: "c7", name: "Van 7", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" };
    gated("*/inventory/containers/c7", van);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.inventory.containers.everything(), [van]);

    const { result } = renderHook(() => useContainer("c7"), { wrapper: wrapper(client) });
    expect(result.current.data?.name).toBe("Van 7");
  });

  it("a warehouse", () => {
    const shop = { id: "w1", name: "Main", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" };
    gated("*/inventory/warehouses/w1", shop);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.inventory.warehouses.list({ limit: 50 }), page([shop]));

    const { result } = renderHook(() => useWarehouse("w1"), { wrapper: wrapper(client) });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.name).toBe("Main");
  });

  it("an item, when asked to (the stock popup's title and prices)", () => {
    const item = { id: "p1", name: "Deadbolt", sku: "LOCK-1", status: InventoryStatus.ACTIVE };
    gated("*/inventory/products/p1", item);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.inventory.products.list({ manageStock: true, limit: 50 }), page([item]));

    const seeded = renderHook(() => useProduct("p1", { seed: true }), { wrapper: wrapper(client) });
    expect(seeded.result.current.data?.name).toBe("Deadbolt");

    // The Edit form does not start from a list row: it waits for the item itself.
    const plain = renderHook(() => useProduct("p1"), { wrapper: wrapper(client) });
    expect(plain.result.current.isPlaceholderData).toBe(false);
  });

  it("reads as usual when no list holds the row", () => {
    gated("*/inventory/containers/c9", { id: "c9" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useContainer("c9"), { wrapper: wrapper(client) });
    expect(result.current.isLoading).toBe(true);
  });
});
