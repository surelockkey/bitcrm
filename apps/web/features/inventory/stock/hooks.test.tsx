import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { InventoryStatus, ReturnReason, TransferType } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useAllLocations, useMoveStock, useReceiveStock, useReturnStock } from "./hooks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const items = [{ productId: "p1", productName: "Deadbolt", quantity: 4 }];

function answer(path: string, data: object) {
  server.use(http.post(`*${path}`, () => HttpResponse.json({ success: true, data })));
}

beforeEach(() => vi.clearAllMocks());

/** One of each product query, split by whether a stock movement changes it. */
function seedProductQueries(client: QueryClient) {
  const moved = [
    queryKeys.inventory.products.list({ manageStock: true, limit: 25 }),
    queryKeys.inventory.products.detail("p1"),
    queryKeys.inventory.products.stock("p1"),
  ];
  const kept = [
    queryKeys.inventory.products.stockMap(),
    queryKeys.inventory.products.map(),
    queryKeys.inventory.products.photo("p1"),
  ];
  for (const key of [...moved, ...kept]) client.setQueryData(key, {});
  return { moved, kept };
}

const invalidated = (client: QueryClient, keys: readonly (readonly unknown[])[]) =>
  keys.map((key) => client.getQueryState(key)?.isInvalidated);

describe("stock movement hooks", () => {
  it("refreshes items, their stock, locations and the journal after a receive", async () => {
    answer("/inventory/transfers/receive", { id: "t1", type: TransferType.RECEIVE, items });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const seeded = seedProductQueries(client);
    const { result } = renderHook(() => useReceiveStock(), { wrapper: wrapper(client) });

    act(() => result.current.mutate({ toType: "warehouse", toId: "w1", items }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // What shows `onHand` or per-location stock goes stale…
    expect(invalidated(client, seeded.moved)).toEqual(seeded.moved.map(() => true));
    // …the catalog maps don't: nothing they hold moves, and re-reading the
    // stock-managed map is up to 200 sequential requests.
    expect(invalidated(client, seeded.kept)).toEqual(seeded.kept.map(() => false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["containers"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["warehouses"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["transfers"] });
    expect(toast.success).toHaveBeenCalledWith("Added 4 units to stock");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("warns by name about items that were not stock-managed", async () => {
    answer("/inventory/transfers", {
      id: "t2",
      type: TransferType.TRANSFER,
      items,
      skippedItems: [{ productId: "p9", productName: "Key cutting", quantity: 1 }],
    });
    const client = new QueryClient();
    const { result } = renderHook(() => useMoveStock(), { wrapper: wrapper(client) });

    act(() =>
      result.current.mutate({ fromType: "container", fromId: "c1", toType: "container", toId: "c2", items }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toast.success).toHaveBeenCalledWith("Moved 4 units");
    expect(toast.warning).toHaveBeenCalledWith("Not stock-managed, skipped: Key cutting");
  });

  it("says how many units were returned", async () => {
    answer("/inventory/transfers/return", { id: "t3", type: TransferType.RETURN, items });
    const client = new QueryClient();
    const seeded = seedProductQueries(client);
    const { result } = renderHook(() => useReturnStock(), { wrapper: wrapper(client) });

    act(() =>
      result.current.mutate({ fromType: "container", fromId: "c1", items, reason: ReturnReason.LOST }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toast.success).toHaveBeenCalledWith("Returned 4 units");
    expect(invalidated(client, seeded.moved)).toEqual(seeded.moved.map(() => true));
    expect(invalidated(client, seeded.kept)).toEqual(seeded.kept.map(() => false));
  });

  it("shows the server's refusal", async () => {
    server.use(
      http.post("*/inventory/transfers/return", () =>
        HttpResponse.json({ success: false, message: "Insufficient stock" }, { status: 400 }),
      ),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useReturnStock(), { wrapper: wrapper(client) });

    act(() =>
      result.current.mutate({ fromType: "container", fromId: "c1", items, reason: ReturnReason.LOST }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith("Insufficient stock");
  });
});

describe("useAllLocations", () => {
  it("pages both lists and answers warehouses first", async () => {
    server.use(
      http.get("*/inventory/warehouses", () =>
        HttpResponse.json({
          success: true,
          data: [{ id: "w1", name: "Main", status: InventoryStatus.ACTIVE }],
          pagination: {},
        }),
      ),
      http.get("*/inventory/containers", () =>
        HttpResponse.json({
          success: true,
          data: [{ id: "c1", name: "Van 1", technicianName: "Taras", status: InventoryStatus.ACTIVE }],
          pagination: {},
        }),
      ),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useAllLocations(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.map((l) => [l.type, l.id])).toEqual([
      ["warehouse", "w1"],
      ["container", "c1"],
    ]);
  });

  it("still lists the vans when the warehouses are off-limits", async () => {
    server.use(
      http.get("*/inventory/warehouses", () =>
        HttpResponse.json({ success: false, message: "Forbidden" }, { status: 403 }),
      ),
      http.get("*/inventory/containers", () =>
        HttpResponse.json({
          success: true,
          data: [{ id: "c1", name: "Van 1", status: InventoryStatus.ACTIVE }],
          pagination: {},
        }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAllLocations(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.map((l) => l.id)).toEqual(["c1"]);
    expect(result.current.isError).toBe(false);
  });

  // An empty answer proves nothing — an enabled hook starts with [] too. What
  // counts is that neither list is being fetched.
  it("fetches nothing while disabled", () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useAllLocations(false), { wrapper: wrapper(client) });
    expect(result.current.data).toEqual([]);
    const queries = client.getQueryCache().findAll();
    expect(queries).toHaveLength(2);
    expect(queries.map((q) => q.state.fetchStatus)).toEqual(["idle", "idle"]);
  });
});
