import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { readAllPages } from "./read-all";

/** A list of `total` rows served `limit` at a time (or whole without one), the cursor being the next offset. */
function pagedList(path: string, total: number, { whole = false } = {}) {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(`*${path}`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      calls.push(q);
      if (whole) {
        return HttpResponse.json({ success: true, data: Array.from({ length: total }, (_, i) => ({ id: `r${i}` })) });
      }
      const start = Number(q.get("cursor") ?? 0);
      const end = Math.min(start + Number(q.get("limit")), total);
      return HttpResponse.json({
        success: true,
        data: Array.from({ length: end - start }, (_, k) => ({ id: `r${start + k}` })),
        pagination: { nextCursor: end < total ? String(end) : undefined, count: end - start },
      });
    }),
  );
  return calls;
}

/**
 * The inventory service keeps `limit`: on dev one request of 100 answers 100
 * of the 209 containers. A helper that reads "everything" reads to the end.
 */
describe("readAllPages", () => {
  it("follows the cursor to the end, a hundred a request, keeping the other params", async () => {
    const calls = pagedList("/inventory/containers", 209);
    const all = await readAllPages<{ id: string }>("/inventory/containers", { status: "active" });
    expect(all).toHaveLength(209);
    expect(all.at(-1)).toEqual({ id: "r208" });
    expect(calls.map((q) => [q.get("status"), q.get("limit"), q.get("cursor")])).toEqual([
      ["active", "100", null],
      ["active", "100", "100"],
      ["active", "100", "200"],
    ]);
  });

  it("reads a list that answers whole in one request, asking no limit", async () => {
    const calls = pagedList("/inventory/brands", 150, { whole: true });
    const all = await readAllPages("/inventory/brands", {}, { pageSize: null });
    expect(all).toHaveLength(150);
    expect(calls).toHaveLength(1);
    expect(calls[0].has("limit")).toBe(false);
  });

  it("follows a cursor there too, should that endpoint start paging", async () => {
    const calls: (string | null)[] = [];
    server.use(
      http.get("*/inventory/categories", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        calls.push(cursor);
        return HttpResponse.json(
          cursor
            ? { success: true, data: [{ id: "c3" }], pagination: { count: 1 } }
            : { success: true, data: [{ id: "c1" }, { id: "c2" }], pagination: { nextCursor: "n1", count: 2 } },
        );
      }),
    );
    const all = await readAllPages("/inventory/categories", {}, { pageSize: null });
    expect(all).toEqual([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    expect(calls).toEqual([null, "n1"]);
  });

  it("stops when the server hands the same cursor back", async () => {
    let calls = 0;
    server.use(
      http.get("*/inventory/warehouses", () => {
        calls += 1;
        return HttpResponse.json({ success: true, data: [{ id: `w${calls}` }], pagination: { nextCursor: "stuck", count: 1 } });
      }),
    );
    const all = await readAllPages("/inventory/warehouses");
    expect(calls).toBe(2);
    expect(all).toHaveLength(2);
  });
});
