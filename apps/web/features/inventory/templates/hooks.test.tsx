import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import {
  useArchiveTemplate,
  useContainerTemplates,
  useCreateTemplate,
  useFillFromWarehouse,
  useRestoreTemplate,
} from "./hooks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const template = { id: "t1", name: "Standard van", items: [], status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" };
const line = (over: object) => ({ productId: "p1", productName: "Deadbolt", sku: "L", target: 4, onHand: 1, missing: 3, ...over });

beforeEach(() => vi.clearAllMocks());

describe("useContainerTemplates", () => {
  it("asks for one status at a time, each cached apart", async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get("*/inventory/container-templates", ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("status"));
        return HttpResponse.json({ success: true, data: [template] });
      }),
    );
    const client = new QueryClient();
    const { result, rerender } = renderHook(({ s }) => useContainerTemplates(s), {
      wrapper: wrapper(client),
      initialProps: { s: InventoryStatus.ACTIVE },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ s: InventoryStatus.ARCHIVED });
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked).toEqual(["active", "archived"]);
  });
});

describe("template mutations", () => {
  function seeded() {
    const client = new QueryClient();
    const keys = [
      queryKeys.inventory.containerTemplates.list(InventoryStatus.ACTIVE),
      queryKeys.inventory.containerTemplates.detail("t1"),
    ];
    for (const key of keys) client.setQueryData(key, {});
    return { client, stale: () => keys.map((k) => client.getQueryState(k)?.isInvalidated) };
  }

  it("creates, then refreshes the templates", async () => {
    server.use(http.post("*/inventory/container-templates", () => HttpResponse.json({ success: true, data: template })));
    const { client, stale } = seeded();
    const { result } = renderHook(() => useCreateTemplate(), { wrapper: wrapper(client) });
    act(() => result.current.mutate({ name: "Standard van", items: [{ productId: "p1", quantity: 1 }] }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual([true, true]);
    expect(toast.success).toHaveBeenCalledWith("Template “Standard van” created");
  });

  it("archives and restores", async () => {
    server.use(
      http.delete("*/inventory/container-templates/t1", () => HttpResponse.json({ success: true, data: template })),
      http.put("*/inventory/container-templates/t1", async ({ request }) => {
        expect(await request.json()).toEqual({ status: "active" });
        return HttpResponse.json({ success: true, data: template });
      }),
    );
    const { client } = seeded();
    const archive = renderHook(() => useArchiveTemplate(), { wrapper: wrapper(client) });
    act(() => archive.result.current.mutate("t1"));
    await waitFor(() => expect(archive.result.current.isSuccess).toBe(true));
    expect(toast.success).toHaveBeenCalledWith("Template archived");
    const restore = renderHook(() => useRestoreTemplate(), { wrapper: wrapper(client) });
    act(() => restore.result.current.mutate("t1"));
    await waitFor(() => expect(restore.result.current.isSuccess).toBe(true));
    expect(toast.success).toHaveBeenCalledWith("Template restored");
  });

  it("shows the server's refusal — a name already taken", async () => {
    server.use(
      http.post("*/inventory/container-templates", () =>
        HttpResponse.json({ success: false, message: "A template named “Standard van” already exists" }, { status: 409 }),
      ),
    );
    const { client } = seeded();
    const { result } = renderHook(() => useCreateTemplate(), { wrapper: wrapper(client) });
    act(() => result.current.mutate({ name: "Standard van", items: [{ productId: "p1", quantity: 1 }] }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith("A template named “Standard van” already exists");
  });
});

describe("useFillFromWarehouse", () => {
  // The fill is a transfer: both locations, the items' onHand, the journal
  // and every template comparison move with it.
  it("refreshes stock, items, locations, the journal and the diffs, and reports what moved", async () => {
    server.use(
      http.post("*/inventory/container-templates/t1/fill", () =>
        HttpResponse.json(
          {
            success: true,
            data: {
              transfer: { id: "tr1" },
              moved: [line({ willMove: 3 })],
              short: [line({ productId: "p2", productName: "Key blank", missing: 20, willMove: 5 })],
            },
          },
          { status: 201 },
        ),
      ),
    );
    const client = new QueryClient();
    const keys = [
      queryKeys.inventory.products.list({ manageStock: true }),
      queryKeys.inventory.products.stock("p1"),
      queryKeys.inventory.locationStock("container", "c1"),
      queryKeys.inventory.warehouses.list({}),
      queryKeys.inventory.transfers.list({}),
      queryKeys.inventory.containerTemplates.diff("t1", "c1", "w1"),
    ];
    for (const key of keys) client.setQueryData(key, {});
    const { result } = renderHook(() => useFillFromWarehouse(), { wrapper: wrapper(client) });

    act(() =>
      result.current.mutate({ id: "t1", body: { containerId: "c1", warehouseId: "w1", requestId: "r-1" }, containerName: "Van 1" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(keys.map((k) => client.getQueryState(k)?.isInvalidated)).toEqual(keys.map(() => true));
    expect(toast.success).toHaveBeenCalledWith("Moved 3 units to Van 1");
    expect(toast.warning).toHaveBeenCalledWith("Still short: Key blank (15)");
  });

  it("warns, and does not celebrate, when nothing could move", async () => {
    server.use(
      http.post("*/inventory/container-templates/t1/fill", () =>
        HttpResponse.json({ success: true, data: { moved: [], short: [line({ willMove: 0 })] } }, { status: 201 }),
      ),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useFillFromWarehouse(), { wrapper: wrapper(client) });
    act(() =>
      result.current.mutate({ id: "t1", body: { containerId: "c1", warehouseId: "w1", requestId: "r-1" }, containerName: "Van 1" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith("Nothing moved — still short: Deadbolt (3)");
  });

  // The same request id twice: the server did the fill once and says so.
  it("treats 409 as already done — says so and refreshes the comparison", async () => {
    server.use(
      http.post("*/inventory/container-templates/t1/fill", () =>
        HttpResponse.json({ success: false, message: "Already processed" }, { status: 409 }),
      ),
    );
    const client = new QueryClient();
    const diff = queryKeys.inventory.containerTemplates.diff("t1", "c1", "w1");
    client.setQueryData(diff, {});
    const { result } = renderHook(() => useFillFromWarehouse(), { wrapper: wrapper(client) });
    act(() =>
      result.current.mutate({ id: "t1", body: { containerId: "c1", warehouseId: "w1", requestId: "r-1" }, containerName: "Van 1" }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.info).toHaveBeenCalledWith("That fill was already made — showing the van as it is now.");
    expect(toast.error).not.toHaveBeenCalled();
    expect(client.getQueryState(diff)?.isInvalidated).toBe(true);
  });
});
