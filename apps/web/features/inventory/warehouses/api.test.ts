import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { countWarehouses, fetchStockManagedProducts, listWarehouses } from "./api";

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

describe("fetchStockManagedProducts", () => {
  it("asks only for stock-managed items — stock rows exist for no others", async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get("*/inventory/products", ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ success: true, data: [{ id: "p1" }], pagination: {} });
      }),
    );
    await fetchStockManagedProducts();
    expect(seen[0].get("manageStock")).toBe("true");
    expect(seen[0].get("limit")).toBe("100");
  });

  it("pages up to 20000 items, not the old 5000, following each cursor", async () => {
    // Served by offset, like the real list: a request without the cursor gets
    // page one again, so a dropped cursor shows up as repeated ids.
    const asked: [string | null, string | null][] = [];
    server.use(
      http.get("*/inventory/products", ({ request }) => {
        const params = new URL(request.url).searchParams;
        asked.push([params.get("limit"), params.get("cursor")]);
        const start = Number(params.get("cursor") ?? 0);
        const end = start + 100;
        return HttpResponse.json({
          success: true,
          data: Array.from({ length: 100 }, (_, i) => ({ id: `p${start + i}` })),
          pagination: { nextCursor: String(end) },
        });
      }),
    );
    const all = await fetchStockManagedProducts();
    expect(all).toHaveLength(20000);
    expect(new Set(all.map((p) => p.id)).size).toBe(20000);
    expect(asked).toHaveLength(200);
    expect(asked.slice(0, 3)).toEqual([
      ["100", null],
      ["100", "100"],
      ["100", "200"],
    ]);
  });
});
