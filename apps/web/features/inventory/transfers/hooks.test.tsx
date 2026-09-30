import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useLocationMap } from "./hooks";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

/** 150 vans: the second page is where the first-page-only map went blind. */
function vans() {
  server.use(
    http.get("*/inventory/containers", ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      const start = cursor ? 100 : 0;
      const end = cursor ? 150 : 100;
      return HttpResponse.json({
        success: true,
        data: Array.from({ length: end - start }, (_, k) => ({ id: `c${start + k}`, name: `Van ${start + k}` })),
        pagination: { nextCursor: cursor ? undefined : "p2" },
      });
    }),
    http.get("*/inventory/warehouses", () =>
      HttpResponse.json({ success: true, data: [{ id: "w1", name: "Main" }], pagination: {} }),
    ),
  );
}

describe("useLocationMap", () => {
  it("names locations past the first page", async () => {
    vans();
    const client = new QueryClient();
    const { result } = renderHook(() => useLocationMap(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.map.get("w1")).toBe("Main");
    expect(result.current.map.get("c149")).toBe("Van 149");
  });
});
