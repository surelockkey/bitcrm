import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useJobsSearch } from "./hooks";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

const hit = (id: string) => ({ entityId: id, type: "deal", title: `Deal #${id}`, badges: [], score: 1 });

/** The search service, answering `total` hits fifty a page; records what was asked. */
function searchService(total: number) {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get("*/search", ({ request }) => {
      const q = new URL(request.url).searchParams;
      asked.push(q);
      const page = Number(q.get("page"));
      const size = Number(q.get("size"));
      const ids = Array.from({ length: total }, (_, i) => `d${i}`).slice((page - 1) * size, page * size);
      return HttpResponse.json({ success: true, data: { query: q.get("q"), mode: "full", groups: [], hits: ids.map(hit), total, took: 1 } });
    }),
  );
  return asked;
}

/** `POST /deals/by-ids`: hands back a job per id; records the ids. */
function hydrate() {
  const asked: string[][] = [];
  server.use(
    http.post("*/deals/by-ids", async ({ request }) => {
      const { ids } = (await request.json()) as { ids: string[] };
      asked.push(ids);
      return HttpResponse.json({ success: true, data: ids.map((id) => ({ id })) });
    }),
  );
  return asked;
}

describe("useJobsSearch — free text across every job", () => {
  it("asks the search service for jobs only, then hydrates the hits in one call", async () => {
    const searched = searchService(3);
    const hydrated = hydrate();
    const { result } = renderHook(() => useJobsSearch("Dustin"), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(searched).toHaveLength(1);
    expect(searched[0].get("q")).toBe("Dustin");
    expect(searched[0].get("type")).toBe("deal");
    expect(searched[0].get("mode")).toBe("full");
    expect(hydrated).toEqual([["d0", "d1", "d2"]]);
    expect(result.current.data).toEqual({ deals: [{ id: "d0" }, { id: "d1" }, { id: "d2" }], capped: false });
  });

  it("reads a second page when there are more than fifty, and says when it stopped at a hundred", async () => {
    const searched = searchService(130);
    const hydrated = hydrate();
    const { result } = renderHook(() => useJobsSearch("Texas"), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(searched.map((q) => q.get("page"))).toEqual(["1", "2"]);
    expect(hydrated[0]).toHaveLength(100);
    expect(result.current.data?.capped).toBe(true);
  });

  it("asks nothing for an empty box", async () => {
    const searched = searchService(3);
    const { result } = renderHook(() => useJobsSearch("   "), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(searched).toHaveLength(0);
    expect(result.current.fetchStatus).toBe("idle");
  });
});
