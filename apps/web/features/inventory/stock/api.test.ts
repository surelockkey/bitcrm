import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus, LocationType, ReturnReason, TransferType } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import {
  fetchAllContainers,
  fetchAllWarehouses,
  getLocationStock,
  moveStock,
  receiveStock,
  returnStock,
} from "./api";

const items = [{ productId: "p1", productName: "Deadbolt", quantity: 2 }];
const answer = { id: "t1", type: TransferType.RECEIVE, items };

function capturePost(path: string) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`*${path}`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ success: true, data: answer });
    }),
  );
  return bodies;
}

describe("stock movements", () => {
  it("receives into any location through /transfers/receive", async () => {
    const bodies = capturePost("/inventory/transfers/receive");
    const t = await receiveStock({ toType: "container", toId: "c1", items, notes: "PO 17" });
    expect(bodies).toEqual([{ toType: "container", toId: "c1", items, notes: "PO 17" }]);
    expect(t).toEqual(answer);
  });

  it("returns out of a location with a reason through /transfers/return", async () => {
    const bodies = capturePost("/inventory/transfers/return");
    await returnStock({ fromType: "warehouse", fromId: "w1", items, reason: ReturnReason.DAMAGED });
    expect(bodies).toEqual([{ fromType: "warehouse", fromId: "w1", items, reason: "damaged" }]);
  });

  it("moves between two locations through /transfers", async () => {
    const bodies = capturePost("/inventory/transfers");
    await moveStock({
      fromType: LocationType.CONTAINER,
      fromId: "c1",
      toType: "container",
      toId: "c2",
      items,
    });
    expect(bodies).toEqual([{ fromType: "container", fromId: "c1", toType: "container", toId: "c2", items }]);
  });
});

/** A list of `total` rows served `limit` at a time, the cursor being the next offset. */
function pagedList(path: string, total: number, make: (i: number) => object) {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(`*${path}`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      calls.push(q);
      const start = Number(q.get("cursor") ?? 0);
      const limit = Number(q.get("limit"));
      const end = Math.min(start + limit, total);
      const data = Array.from({ length: end - start }, (_, k) => make(start + k));
      return HttpResponse.json({
        success: true,
        data,
        pagination: { nextCursor: end < total ? String(end) : undefined, count: data.length },
      });
    }),
  );
  return calls;
}

describe("fetchAllContainers / fetchAllWarehouses", () => {
  it("follows the cursor to the end, a hundred at a time", async () => {
    const calls = pagedList("/inventory/containers", 250, (i) => ({ id: `c${i}`, name: `Van ${i}` }));
    const all = await fetchAllContainers();
    expect(all).toHaveLength(250);
    expect(calls.map((q) => [q.get("limit"), q.get("cursor")])).toEqual([
      ["100", null],
      ["100", "100"],
      ["100", "200"],
    ]);
  });

  // The old read stopped at 2000 rows; a list longer than that lost its tail.
  it("reads every row, however many pages that takes", async () => {
    const calls = pagedList("/inventory/warehouses", 2350, (i) => ({ id: `w${i}`, name: `W ${i}` }));
    const all = await fetchAllWarehouses();
    expect(all).toHaveLength(2350);
    expect(all.at(-1)).toMatchObject({ id: "w2349" });
    expect(calls).toHaveLength(24);
  });
});

/**
 * One location's stock in one request, named and priced by the server —
 * joining it to the whole stock-managed catalog was 32 sequential requests
 * and eight seconds on dev.
 */
describe("getLocationStock", () => {
  const view = {
    locationType: "container",
    locationId: "c1",
    name: "Taras's van",
    status: InventoryStatus.ACTIVE,
    rows: [{ productId: "p1", productName: "Deadbolt", sku: "LOCK-001", quantity: 6, priceClient: 45 }],
  };

  it("reads GET /inventory/stock/locations/:type/:id", async () => {
    const paths: string[] = [];
    server.use(
      http.get("*/inventory/stock/locations/:type/:id", ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({ success: true, data: view });
      }),
    );
    expect(await getLocationStock("container", "c1")).toEqual(view);
    await getLocationStock("warehouse", "w1");
    expect(paths.map((p) => p.replace(/^.*\/inventory/, "/inventory"))).toEqual([
      "/inventory/stock/locations/container/c1",
      "/inventory/stock/locations/warehouse/w1",
    ]);
  });

  it("encodes the id rather than trusting it", async () => {
    const paths: string[] = [];
    server.use(
      http.get("*/inventory/stock/locations/*", ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({ success: true, data: view });
      }),
    );
    await getLocationStock("container", "a/b");
    expect(paths[0]).toMatch(/\/inventory\/stock\/locations\/container\/a%2Fb$/);
  });
});
