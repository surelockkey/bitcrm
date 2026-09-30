import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * A picker needs the types someone can still choose. Of the 898 that came over
 * from Workiz, 21 are active — asking for all of them cost a dispatcher about
 * a second on every job page to draw a list of twenty-one.
 *
 * The full catalog is still fetched where names of archived types must be
 * resolved (the jobs list), so the two live under different query keys and
 * neither evicts the other.
 */
const queries: { queryKey: unknown; queryFn: () => unknown }[] = [];
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown; queryFn: () => unknown }) => {
    queries.push(opts);
    return { data: undefined };
  },
}));

const listCalls: (boolean | undefined)[] = [];
vi.mock("./api", () => ({
  listJobTypes: (activeOnly?: boolean) => {
    listCalls.push(activeOnly);
    return Promise.resolve([]);
  },
}));

const { useActiveJobTypes } = await import("./active-hooks");

describe("useActiveJobTypes", () => {
  beforeEach(() => {
    queries.length = 0;
    listCalls.length = 0;
  });

  it("asks the server for the active ones, not the whole catalog", async () => {
    renderHook(() => useActiveJobTypes());
    await queries[0].queryFn();
    expect(listCalls).toEqual([true]);
  });

  it("caches apart from the full catalog, so neither replaces the other", () => {
    renderHook(() => useActiveJobTypes());
    expect(queries[0].queryKey).toEqual(["job-types", "list", "active"]);
  });
});
