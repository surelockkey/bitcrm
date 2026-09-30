import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { fetchTechStock } from "./tech-stock";

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
      http.get("*/inventory/containers/c-taras/stock", () =>
        HttpResponse.json({
          success: true,
          data: [{ productId: "p1", productName: "Deadbolt", quantity: 3, updatedAt: "" }],
        }),
      ),
    );
    const stock = await fetchTechStock("taras");
    expect(stock.get("p1")).toBe(3);
  });

  it("answers an empty map for a technician without a van", async () => {
    server.use(
      http.get("*/inventory/containers", () =>
        HttpResponse.json({ success: true, data: [], pagination: {} }),
      ),
    );
    expect((await fetchTechStock("nobody")).size).toBe(0);
  });
});
