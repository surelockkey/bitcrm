import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useUserMap } from "./hooks";
import { useUserMap as useDealsUserMap } from "@/features/deals/hooks";

const USERS = [
  { id: "u1", email: "ada@bitcrm.test", firstName: "Ada", lastName: "Lovelace" },
  { id: "u2", email: "grace@bitcrm.test", firstName: "Grace", lastName: "Hopper" },
];

function mockUsers() {
  server.use(
    http.get("*/users", () =>
      HttpResponse.json({ success: true, data: USERS, pagination: { count: USERS.length } }),
    ),
  );
}

/** Both hooks share one cache key, so they must agree on the cached shape. */
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe("useUserMap cache-key sharing", () => {
  it("returns a Map even when the deals hook populated the shared cache entry first", async () => {
    mockUsers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Deals mounts first — it writes User[] into ["users","all-map"].
    const deals = renderHook(() => useDealsUserMap(), { wrapper: wrapper(client) });
    await waitFor(() => expect(deals.result.current.isLoading).toBe(false));

    // Technicians reads the same cache entry.
    const techs = renderHook(() => useUserMap(), { wrapper: wrapper(client) });
    await waitFor(() => expect(techs.result.current.data).toBeDefined());

    expect(techs.result.current.data).toBeInstanceOf(Map);
    expect(techs.result.current.data?.get("u1")?.firstName).toBe("Ada");
  });

  it("returns a Map when technicians mounts first", async () => {
    mockUsers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const techs = renderHook(() => useUserMap(), { wrapper: wrapper(client) });
    await waitFor(() => expect(techs.result.current.data).toBeDefined());

    expect(techs.result.current.data).toBeInstanceOf(Map);
    expect(techs.result.current.data?.get("u2")?.lastName).toBe("Hopper");
  });

  it("keeps the deals hook's Map working off the same cache entry", async () => {
    mockUsers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const techs = renderHook(() => useUserMap(), { wrapper: wrapper(client) });
    await waitFor(() => expect(techs.result.current.data).toBeDefined());

    const deals = renderHook(() => useDealsUserMap(), { wrapper: wrapper(client) });
    await waitFor(() => expect(deals.result.current.isLoading).toBe(false));

    expect(deals.result.current.map).toBeInstanceOf(Map);
    expect(deals.result.current.map.get("u1")?.email).toBe("ada@bitcrm.test");
    expect(deals.result.current.users).toHaveLength(2);
  });
});
