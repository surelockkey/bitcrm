import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { fetchTechStock, fetchTechStockRows } from "./tech-stock";

/** The technician has no assignment row: the legacy technicianId link decides. */
function noRow() {
  server.use(
    http.get("*/inventory/user-containers/:userId", () =>
      HttpResponse.json({ success: false, message: "Not found" }, { status: 404 }),
    ),
  );
}

const view = (id: string, rows: object[]) =>
  HttpResponse.json({
    success: true,
    data: { locationType: "container", locationId: id, name: id, status: "active", rows },
  });

describe("fetchTechStock", () => {
  it("finds the technician's van even when it is not on the first page", async () => {
    noRow();
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
    noRow();
    server.use(
      http.get("*/inventory/containers", () =>
        HttpResponse.json({ success: true, data: [], pagination: {} }),
      ),
    );
    expect((await fetchTechStock("nobody")).size).toBe(0);
    expect(await fetchTechStockRows("nobody")).toEqual([]);
  });
});

/**
 * Which van a technician works from is their user-container row first — a
 * tech may have taken another's van — and the legacy link only without one.
 */
describe("fetchTechStock — the technician's assignment", () => {
  it("reads the van the assignment names, without walking the fleet", async () => {
    const paths: string[] = [];
    server.events.on("request:start", ({ request }) => {
      paths.push(new URL(request.url).pathname.replace(/^.*\/inventory/, "/inventory"));
    });
    server.use(
      http.get("*/inventory/user-containers/mike", () =>
        HttpResponse.json({
          success: true,
          data: { userId: "mike", userName: "Mike", access: "container", containerId: "c-taras", limited: false, updatedAt: "" },
        }),
      ),
      http.get("*/inventory/stock/locations/container/c-taras", () =>
        view("c-taras", [{ productId: "p1", productName: "Deadbolt", quantity: 5 }]),
      ),
    );
    expect((await fetchTechStock("mike")).get("p1")).toBe(5);
    server.events.removeAllListeners();
    expect(paths).toEqual([
      "/inventory/user-containers/mike",
      "/inventory/stock/locations/container/c-taras",
    ]);
  });

  it("carries nothing on All locations or No access, even if a van still names them", async () => {
    for (const access of ["all", "none"]) {
      server.use(
        http.get("*/inventory/user-containers/taras", () =>
          HttpResponse.json({
            success: true,
            data: { userId: "taras", userName: "Taras", access, limited: false, updatedAt: "" },
          }),
        ),
      );
      expect(await fetchTechStockRows("taras")).toEqual([]);
    }
  });
});
