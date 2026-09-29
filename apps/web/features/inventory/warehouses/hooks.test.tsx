import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useProductMap } from "./hooks";

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
