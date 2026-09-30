import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { UserContainerAccess } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useAssignUserContainer, useUserContainers } from "./hooks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const row = {
  userId: "u1",
  userName: "Taras Koval",
  access: UserContainerAccess.CONTAINER,
  containerId: "c2",
  containerName: "Van 2",
  limited: false,
  updatedAt: "",
};

beforeEach(() => vi.clearAllMocks());

describe("useUserContainers", () => {
  it("reads every row in one request", async () => {
    let calls = 0;
    server.use(
      http.get("*/inventory/user-containers", () => {
        calls += 1;
        return HttpResponse.json({ success: true, data: [row] });
      }),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useUserContainers(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([row]);
    expect(calls).toBe(1);
  });
});

describe("useAssignUserContainer", () => {
  // Who works from which van shows on User containers, on Containers, in the
  // pickers — and on the technician's own "My container".
  it("refreshes the assignments, the vans and the technician's own van", async () => {
    server.use(
      http.put("*/inventory/user-containers/u1", () => HttpResponse.json({ success: true, data: row })),
    );
    const client = new QueryClient();
    const keys = [
      queryKeys.inventory.userContainers.list(),
      queryKeys.inventory.userContainers.mine(),
      queryKeys.inventory.containers.list({}),
      queryKeys.inventory.containers.everything(),
      queryKeys.inventory.containers.mine(),
    ];
    for (const key of keys) client.setQueryData(key, {});
    const { result } = renderHook(() => useAssignUserContainer(), { wrapper: wrapper(client) });

    act(() =>
      result.current.mutate({
        userId: "u1",
        body: { userName: "Taras Koval", access: UserContainerAccess.CONTAINER, containerId: "c2" },
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(keys.map((k) => client.getQueryState(k)?.isInvalidated)).toEqual(keys.map(() => true));
    expect(toast.success).toHaveBeenCalledWith("Taras Koval now works from Van 2");
  });

  it("names All locations and No access in the toast", async () => {
    server.use(
      http.put("*/inventory/user-containers/u1", () =>
        HttpResponse.json({
          success: true,
          data: { ...row, access: UserContainerAccess.ALL, containerId: undefined, containerName: undefined },
        }),
      ),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useAssignUserContainer(), { wrapper: wrapper(client) });
    act(() =>
      result.current.mutate({ userId: "u1", body: { userName: "Taras Koval", access: UserContainerAccess.ALL } }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toast.success).toHaveBeenCalledWith("Taras Koval: All locations");
  });

  it("shows the server's refusal — an archived van", async () => {
    server.use(
      http.put("*/inventory/user-containers/u1", () =>
        HttpResponse.json({ success: false, message: "Container is archived" }, { status: 400 }),
      ),
    );
    const client = new QueryClient();
    const { result } = renderHook(() => useAssignUserContainer(), { wrapper: wrapper(client) });
    act(() =>
      result.current.mutate({
        userId: "u1",
        body: { userName: "Taras Koval", access: UserContainerAccess.CONTAINER, containerId: "c9" },
      }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith("Container is archived");
  });
});
