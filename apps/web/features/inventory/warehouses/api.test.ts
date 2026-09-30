import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { countWarehouses, fetchAllProducts, listWarehouses } from "./api";

function capture(path: string, body: object) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(`*${path}`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, ...body });
    }),
  );
  return seen;
}

describe("warehouses list + count", () => {
  it("asks the server to search and filter by status", async () => {
    const seen = capture("/inventory/warehouses", { data: [], pagination: {} });
    await listWarehouses({ search: "dal", status: InventoryStatus.ARCHIVED }, "cur", 25);
    expect(Object.fromEntries(seen[0])).toEqual({
      search: "dal",
      status: "archived",
      cursor: "cur",
      limit: "25",
    });
  });

  it("counts under the same filters", async () => {
    const seen = capture("/inventory/warehouses/count", { data: { total: 2, atLeast: false } });
    await expect(countWarehouses({ search: "dal" })).resolves.toEqual({ total: 2, atLeast: false });
    expect(Object.fromEntries(seen[0])).toEqual({ search: "dal" });
  });
});

/**
 * The job and estimate item pickers offer the whole active catalog. The old
 * read stopped at 5 000 rows of the ~16 000 (active and archived, in name
 * order): items past the first third of the alphabet were never offered.
 */
describe("fetchAllProducts", () => {
  it("reads every active item to the end of the cursor — past 5 000", async () => {
    const total = 5230;
    const seen: URLSearchParams[] = [];
    server.use(
      http.get("*/inventory/products", ({ request }) => {
        const q = new URL(request.url).searchParams;
        seen.push(q);
        const start = Number(q.get("cursor") ?? 0);
        const end = Math.min(start + Number(q.get("limit")), total);
        return HttpResponse.json({
          success: true,
          data: Array.from({ length: end - start }, (_, k) => ({ id: `p${start + k}`, status: "active" })),
          pagination: { nextCursor: end < total ? String(end) : undefined, count: end - start },
        });
      }),
    );

    const all = await fetchAllProducts();

    expect(all).toHaveLength(total);
    expect(all.at(-1)).toMatchObject({ id: "p5229" });
    expect(seen).toHaveLength(53);
    expect(seen.every((q) => q.get("status") === "active" && q.get("limit") === "100")).toBe(true);
  });
});
