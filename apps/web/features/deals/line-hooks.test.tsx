import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Deal, DealProduct } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";

const api = vi.hoisted(() => ({
  addDealProduct: vi.fn(),
  removeDealProduct: vi.fn(),
  replaceDealProduct: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

import { useAddProduct, useRemoveProduct } from "./hooks";

const line = (over: Partial<DealProduct> = {}): DealProduct => ({
  lineId: "l1", productId: "p1", name: "Deadbolt", sku: "KW-1", quantity: 1, costCompany: 7, costForTech: 0,
  priceClient: 50, fulfillment: "to_order", taxable: true, addedBy: "u1", addedAt: "", ...over,
});
const deal = { id: "d1", dealNumber: "K4T9ZW", assignedTechIds: [], taxRatePercent: 0, itemCount: 1,
  totals: { subtotal: 50, discount: 0, tax: 0, total: 50, cost: 7 } } as unknown as Deal;

/** A pending server: the test decides when (and how) the write answers. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(queryKeys.deals.products("d1"), [line()]);
  qc.setQueryData(queryKeys.deals.detail("d1"), deal);
  api.addDealProduct.mockReset();
  api.removeDealProduct.mockReset();
});

const lines = () => qc.getQueryData<DealProduct[]>(queryKeys.deals.products("d1")) ?? [];
const job = () => qc.getQueryData<Deal>(queryKeys.deals.detail("d1"))!;

describe("useRemoveProduct — the row goes as it is clicked", () => {
  it("empties the table and the job's money before the server answers, and leaves them so when it does", async () => {
    const server = deferred<{ removed: true }>();
    api.removeDealProduct.mockReturnValue(server.promise);
    const { result } = renderHook(() => useRemoveProduct("d1"), { wrapper });

    act(() => result.current.mutate("l1"));
    await waitFor(() => expect(lines()).toEqual([]));
    expect(job()).toMatchObject({ itemCount: 0, totals: { total: 0, cost: 0 } });

    await act(async () => { server.resolve({ removed: true }); await server.promise; });
    expect(lines()).toEqual([]);
  });

  it("puts the row and the money back when the server refuses", async () => {
    const server = deferred<{ removed: true }>();
    api.removeDealProduct.mockReturnValue(server.promise);
    const { result } = renderHook(() => useRemoveProduct("d1"), { wrapper });

    act(() => result.current.mutate("l1"));
    await waitFor(() => expect(lines()).toEqual([]));

    await act(async () => { server.reject(new Error("no")); await server.promise.catch(() => {}); });
    await waitFor(() => expect(lines()).toHaveLength(1));
    expect(job()).toMatchObject({ itemCount: 1, totals: { total: 50 } });
  });
});

describe("useAddProduct — the server's line lands with the answer", () => {
  it("puts the written line and the new money in the cache in the same tick as success", async () => {
    const written = line({ lineId: "l2", productId: "p2", priceClient: 30, costCompany: 3 });
    api.addDealProduct.mockResolvedValue({ added: true, line: written });
    const { result } = renderHook(() => useAddProduct("d1"), { wrapper });

    await act(async () => { await result.current.mutateAsync({ productId: "p2", name: "x", sku: "x", quantity: 1, priceClient: 30, fulfillment: "to_order" }); });

    expect(lines().map((l) => l.lineId)).toEqual(["l1", "l2"]);
    expect(job()).toMatchObject({ itemCount: 2, totals: { total: 80, cost: 10 } });
  });

  it("an older server (no line in the answer) leaves the cache to the reread", async () => {
    api.addDealProduct.mockResolvedValue({ added: true });
    const { result } = renderHook(() => useAddProduct("d1"), { wrapper });

    await act(async () => { await result.current.mutateAsync({ productId: "p2", name: "x", sku: "x", quantity: 1, priceClient: 30, fulfillment: "to_order" }); });

    expect(lines()).toHaveLength(1);
  });
});
