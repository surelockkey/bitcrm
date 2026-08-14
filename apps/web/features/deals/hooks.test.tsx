import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse, delay } from "msw";
import { JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useMoveStatus, useSetDealTags } from "./hooks";

// Capture toast calls so we can assert exactly what the user is shown.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  toast.error.mockClear();
  toast.success.mockClear();
});

describe("useSetDealTags — optimistic tag save", () => {
  const seed = (client: QueryClient, tagIds: string[]) =>
    client.setQueryData(queryKeys.deals.detail("d1"), { id: "d1", tagIds } as Deal);
  const cachedTagIds = (client: QueryClient) =>
    (client.getQueryData(queryKeys.deals.detail("d1")) as Deal | undefined)?.tagIds;

  it("paints the new tag in the cache before the server answers", async () => {
    // The server never replies — only the optimistic patch can put the tag
    // in the cache, so this proves the chip paints before the round-trip.
    server.use(http.put("*/deals/d1", () => delay("infinite")));

    const client = newClient();
    seed(client, []);
    const { result } = renderHook(() => useSetDealTags("d1"), { wrapper: wrapper(client) });

    result.current.mutate(["t1"]);

    await waitFor(() => expect(cachedTagIds(client)).toEqual(["t1"]));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("rolls the cache back and shows the error when the save fails", async () => {
    server.use(
      http.put("*/deals/d1", () =>
        HttpResponse.json({ success: false, message: "Nope" }, { status: 403 }),
      ),
    );

    const client = newClient();
    seed(client, ["t0"]);
    const { result } = renderHook(() => useSetDealTags("d1"), { wrapper: wrapper(client) });

    result.current.mutate(["t0", "t1"]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
    expect(cachedTagIds(client)).toEqual(["t0"]);
  });
});

describe("useMoveStatus — required-to-close gate (422)", () => {
  it("tells the user exactly which fields to fill instead of a generic error", async () => {
    // The backend rejects the terminal move with 422 + the unfilled fields.
    server.use(
      http.put("*/deals/d1/status", () =>
        HttpResponse.json(
          {
            success: false,
            message: "Required fields must be filled before closing",
            missingFields: [
              { id: "cf-gate", name: "Gate Code" },
              { id: "cf-invoice", name: "Invoice Number" },
            ],
          },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(() => useMoveStatus("d1"), {
      wrapper: wrapper(newClient()),
    });

    result.current.mutate({ superStatus: JobSuperStatus.DONE });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    const shown = toast.error.mock.calls.map((c) => String(c[0])).join("\n");
    // The two missing field names must be surfaced by name.
    expect(shown).toContain("Gate Code");
    expect(shown).toContain("Invoice Number");
    // Not a bare generic fallback.
    expect(shown).not.toBe("Something went wrong. Please try again.");
  });

  it("still shows the plain error message for a non-422 failure", async () => {
    server.use(
      http.put("*/deals/d1/status", () =>
        HttpResponse.json(
          { success: false, message: "You can't move this job" },
          { status: 403 },
        ),
      ),
    );

    const { result } = renderHook(() => useMoveStatus("d1"), {
      wrapper: wrapper(newClient()),
    });

    result.current.mutate({ superStatus: JobSuperStatus.DONE });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can't move this job"));
  });
});
