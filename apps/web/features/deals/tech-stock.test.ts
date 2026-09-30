import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { fetchTechStock, fetchTechStockRows } from "./tech-stock";

describe("fetchTechStock", () => {
  it("finds the technician's van even when it is not on the first page", async () => {
    server.use(
      http.get("*/inventory/containers", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (!cursor) {
          return HttpResponse.json({
            success: true,
            data: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, name: `Van ${i}`, technicianId: `u${i}` })),
            pagination: { nextCursor: "p2" },
          });
        }
        return HttpResponse.json({
          success: true,
          data: [{ id: "c-taras", name: "Taras's van", technicianId: "taras" }],
          pagination: {},
        });
      }),
      http.get("*/inventory/stock/locations/container/c-taras", () =>
        HttpResponse.json({
          success: true,
          data: {
            locationType: "container",
            locationId: "c-taras",
            name: "Taras's van",
            status: "active",
            rows: [{ productId: "p1", productName: "Deadbolt", quantity: 3 }],
          },
        }),
      ),
    );
    const stock = await fetchTechStock("taras");
    expect(stock.get("p1")).toBe(3);
    // Named by the stock endpoint — no catalog lookup behind it.
    expect(await fetchTechStockRows("taras")).toEqual([
      { productId: "p1", productName: "Deadbolt", quantity: 3 },
    ]);
  });

  it("answers an empty map for a technician without a van", async () => {
    server.use(
      http.get("*/inventory/containers", () =>
        HttpResponse.json({ success: true, data: [], pagination: {} }),
      ),
    );
    expect((await fetchTechStock("nobody")).size).toBe(0);
    expect(await fetchTechStockRows("nobody")).toEqual([]);
  });
});
