import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useProductMap, useReceiveIntoWarehouse } from "./hooks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

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

describe("useReceiveIntoWarehouse", () => {
  it("counts what the answer says was received and names what was skipped", async () => {
    let body: unknown;
    server.use(
      http.post("*/inventory/warehouses/w1/receive", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            id: "t1",
            type: "receive",
            items: [{ productId: "p1", productName: "Deadbolt", quantity: 3 }],
            skippedItems: [{ productId: "p2", productName: "Key cutting", quantity: 1 }],
          },
        });
      }),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useReceiveIntoWarehouse(), { wrapper: wrapper(client) });
    const items = [
      { productId: "p1", productName: "Deadbolt", quantity: 3 },
      { productId: "p2", productName: "Key cutting", quantity: 1 },
    ];

    act(() => result.current.mutate({ id: "w1", items }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(body).toEqual({ items });
    expect(toast.success).toHaveBeenCalledWith("Added 3 units to stock");
    expect(toast.warning).toHaveBeenCalledWith("Not stock-managed, skipped: Key cutting");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["products"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["transfers"] });
  });
});
