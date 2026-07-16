import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useAllTechnicians } from "./hooks";

function profile(id: string) {
  return { userId: id, status: "active", callMaskingEnabled: false };
}

/** Two cursor pages, so a hook that reads only the first is caught. */
function mockTwoPages() {
  const requests: string[] = [];
  server.use(
    http.get("*/users/technicians", ({ request }) => {
      const url = new URL(request.url);
      const cursor = url.searchParams.get("cursor");
      requests.push(cursor ?? "first");

      if (!cursor) {
        return HttpResponse.json({
          success: true,
          data: [profile("tech-1")],
          pagination: { nextCursor: "page-2", count: 1 },
        });
      }
      return HttpResponse.json({
        success: true,
        data: [profile("tech-2")],
        pagination: { count: 1 },
      });
    }),
  );
  return requests;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAllTechnicians", () => {
  /**
   * The dispatch map places technicians by home coordinates, so it needs every
   * profile. Reading only the first page silently omits everyone past the
   * hundredth — a missing marker looks like an idle technician, not a paging bug.
   */
  it("drains every cursor page, not just the first", async () => {
    mockTwoPages();
    const { result } = renderHook(() => useAllTechnicians(true), {
      wrapper: wrapper(newClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profiles.map((p) => p.userId)).toEqual(["tech-1", "tech-2"]);
  });

  it("reports loading until the last page has arrived", async () => {
    mockTwoPages();
    const { result } = renderHook(() => useAllTechnicians(true), {
      wrapper: wrapper(newClient()),
    });

    // A half-drained list must not be handed to the map as if it were complete.
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toHaveLength(2);
  });

  // A dispatcher may see the map but not the technician roster; firing the
  // request anyway 403s on every page load.
  it("does not request anything when disabled", async () => {
    const requests = mockTwoPages();
    const { result } = renderHook(() => useAllTechnicians(false), {
      wrapper: wrapper(newClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(requests).toEqual([]);
    expect(result.current.profiles).toEqual([]);
  });
});
