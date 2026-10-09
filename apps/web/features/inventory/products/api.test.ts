import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { countProducts, getProductStock, listProducts } from "./api";

/** Records the query string of every call to `path` and answers `body`. */
function capture(path: string, body: unknown) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(`*${path}`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, ...(body as object) });
    }),
  );
  return seen;
}

const everyFilter = {
  category: "Locks",
  type: ProductType.PRODUCT,
  status: InventoryStatus.ACTIVE,
  search: "dead",
  manageStock: true,
  brandId: "b1",
};

describe("listProducts", () => {
  it("sends every filter at once — the server combines them now", async () => {
    const seen = capture("/inventory/products", { data: [], pagination: {} });
    await listProducts(everyFilter, "cur-1", 25);
    const q = seen[0];
    expect(Object.fromEntries(q)).toEqual({
      category: "Locks",
      type: "product",
      status: "active",
      search: "dead",
      manageStock: "true",
      brandId: "b1",
      cursor: "cur-1",
      limit: "25",
    });
  });

  // Workiz's "All Stock Levels" box: the server splits Stocked from Low Stock.
  it("sends the stock level to the list and the count", async () => {
    const list = capture("/inventory/products", { data: [], pagination: {} });
    const count = capture("/inventory/products/count", { data: { total: 1, atLeast: false } });
    await listProducts({ manageStock: true, stockLevel: "low" });
    await countProducts({ manageStock: true, stockLevel: "stocked" });
    expect(list[0].get("stockLevel")).toBe("low");
    expect(count[0].get("stockLevel")).toBe("stocked");
  });

  it("sends manageStock=false rather than dropping it", async () => {
    const seen = capture("/inventory/products", { data: [], pagination: {} });
    await listProducts({ manageStock: false });
    expect(seen[0].get("manageStock")).toBe("false");
  });

  it("leaves unset filters out", async () => {
    const seen = capture("/inventory/products", { data: [], pagination: {} });
    await listProducts({});
    expect([...seen[0].keys()]).toEqual(["limit"]);
  });
});

describe("countProducts", () => {
  it("counts under the same filters the list uses", async () => {
    const seen = capture("/inventory/products/count", { data: { total: 3, atLeast: false } });
    await expect(countProducts(everyFilter)).resolves.toEqual({ total: 3, atLeast: false });
    expect(Object.fromEntries(seen[0])).toEqual({
      category: "Locks",
      type: "product",
      status: "active",
      search: "dead",
      manageStock: "true",
      brandId: "b1",
    });
  });
});

describe("getProductStock", () => {
  it("reads one product's stock across every location in a single call", async () => {
    const stock = {
      productId: "p1",
      onHand: 7,
      locations: [
        { locationType: "warehouse", locationId: "w1", name: "Main", status: "active", quantity: 5 },
        { locationType: "container", locationId: "c1", name: "Van 1", status: "active", quantity: 2 },
      ],
    };
    capture("/inventory/stock/products/p1", { data: stock });
    await expect(getProductStock("p1")).resolves.toEqual(stock);
  });
});
