import { describe, it, expect } from "vitest";
import { TransferType, LocationType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import { summarizeStock, transferUnits, type EnrichedStockRow } from "./lib";

const rows: EnrichedStockRow[] = [
  { productId: "p1", name: "Deadbolt", quantity: 8, unitPrice: 45, value: 360, minLevel: 10, isLow: true },
  { productId: "p2", name: "Key blank", quantity: 500, unitPrice: 3, value: 1500, minLevel: 0, isLow: false },
  { productId: "p3", name: "Mystery", quantity: 4, isLow: false }, // no price
];

describe("summarizeStock", () => {
  it("totals SKUs, units, value and low count", () => {
    const s = summarizeStock(rows);
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

  it("sums item quantities", () => {
    expect(transferUnits(transfer({ items: [
      { productId: "p1", productName: "a", quantity: 3 },
      { productId: "p2", productName: "b", quantity: 4 },
    ] }))).toBe(7);
  });
});
