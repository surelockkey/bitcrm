import { describe, it, expect } from "vitest";
import {
  InventoryStatus,
  ProductType,
  TransferType,
  LocationType,
} from "@bitcrm/types";
import type { Product, StockItem, Transfer } from "@bitcrm/types";
import {
  enrichStock,
  summarizeStock,
  transferDirection,
  transferUnits,
  containerLabel,
} from "./lib";

function product(over: Partial<Product>): Product {
  return {
    id: "p1",
    sku: "SKU-1",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 15,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 10,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const map = new Map<string, Product>([
  ["p1", product({ id: "p1", sku: "LOCK-1", priceClient: 45, minimumStockLevel: 10 })],
  ["p2", product({ id: "p2", sku: "KEY-1", priceClient: 3, minimumStockLevel: 0 })],
]);

const stock: StockItem[] = [
  { productId: "p1", productName: "Deadbolt", quantity: 8, updatedAt: "" },
  { productId: "p2", productName: "Key blank", quantity: 500, updatedAt: "" },
  { productId: "p3", productName: "Mystery", quantity: 4, updatedAt: "" }, // not in catalog
];

describe("enrichStock", () => {
  const rows = enrichStock(stock, map);

  it("joins catalog fields (sku, price, value)", () => {
    expect(rows[0].sku).toBe("LOCK-1");
    expect(rows[0].unitPrice).toBe(45);
    expect(rows[0].value).toBe(360); // 8 * 45
  });

  it("flags low stock when on-hand <= min level", () => {
    expect(rows[0].isLow).toBe(true); // 8 <= 10
    expect(rows[1].isLow).toBe(false); // min 0 → never low
  });

  it("falls back to the stock row when the product isn't in the catalog", () => {
    expect(rows[2].name).toBe("Mystery");
    expect(rows[2].unitPrice).toBeUndefined();
    expect(rows[2].value).toBeUndefined();
    expect(rows[2].isLow).toBe(false);
  });
});

describe("summarizeStock", () => {
  it("totals SKUs, units, value and low count", () => {
    const s = summarizeStock(enrichStock(stock, map));
    expect(s.skuCount).toBe(3);
    expect(s.totalUnits).toBe(512);
    expect(s.totalValue).toBe(360 + 1500); // p1 360, p2 1500, p3 unknown
    expect(s.lowCount).toBe(1);
  });
});

describe("transfer helpers", () => {
  function transfer(over: Partial<Transfer>): Transfer {
    return {
      id: "t1",
      type: TransferType.TRANSFER,
      fromType: LocationType.WAREHOUSE,
      fromId: "w1",
      toType: LocationType.CONTAINER,
      toId: "c1",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 5 }],
      performedBy: "u1",
      performedByName: "a@b.com",
      createdAt: "",
      ...over,
    };
  }

  it("direction is 'in' for receives and inbound moves, 'out' for outbound", () => {
    expect(transferDirection(transfer({ type: TransferType.RECEIVE, fromType: LocationType.SUPPLIER, fromId: null, toId: "w1" }), "w1")).toBe("in");
    expect(transferDirection(transfer({ fromId: "w1", toType: LocationType.CONTAINER }), "w1")).toBe("out");
    expect(transferDirection(transfer({ fromType: LocationType.CONTAINER, fromId: "c1", toType: LocationType.WAREHOUSE, toId: "w1" }), "w1")).toBe("in");
  });

  it("sums item quantities", () => {
    expect(transferUnits(transfer({ items: [
      { productId: "p1", productName: "a", quantity: 3 },
      { productId: "p2", productName: "b", quantity: 4 },
    ] }))).toBe(7);
  });
});

describe("containerLabel", () => {
  it("uses the technician name", () => {
    expect(
      containerLabel({ technicianName: "Riley Santos", department: "Field" } as never),
    ).toBe("Riley Santos");
  });
  it("falls back when no name", () => {
    expect(containerLabel({ technicianName: "", department: "" } as never)).toBe("Container");
  });
});
