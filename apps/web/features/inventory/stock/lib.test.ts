import { describe, it, expect } from "vitest";
import { InventoryStatus, LocationType, TransferType } from "@bitcrm/types";
import type { Container, Transfer, Warehouse } from "@bitcrm/types";
import {
  checkQuantity,
  filterItemRows,
  filterStockRows,
  locationCards,
  locationHint,
  moveTargets,
  movementMessages,
  pageSlice,
  stockRowsOf,
  stockSummary,
  toLocations,
  type StockLocation,
} from "./lib";

function transfer(over: Partial<Transfer> = {}): Transfer {
  return {
    id: "t1",
    type: TransferType.RECEIVE,
    fromType: LocationType.SUPPLIER,
    fromId: null,
    toType: LocationType.WAREHOUSE,
    toId: "w1",
    items: [
      { productId: "p1", productName: "Deadbolt", quantity: 3 },
      { productId: "p2", productName: "Strike plate", quantity: 2 },
    ],
    performedBy: "u1",
    performedByName: "Jane",
    createdAt: "",
    ...over,
  };
}

describe("movementMessages", () => {
  it("counts the units that actually moved", () => {
    expect(movementMessages("receive", transfer())).toEqual({ success: "Added 5 units to stock" });
    expect(movementMessages("move", transfer({ items: [{ productId: "p1", productName: "A", quantity: 1 }] }))).toEqual({
      success: "Moved 1 unit",
    });
    expect(movementMessages("return", transfer())).toEqual({ success: "Returned 5 units" });
  });

  it("names the items the server skipped as not stock-managed", () => {
    const m = movementMessages(
      "receive",
      transfer({
        skippedItems: [
          { productId: "p9", productName: "Key cutting", quantity: 1 },
          { productId: "p8", productName: "Lockout", quantity: 2 },
        ],
      }),
    );
    expect(m.warning).toBe("Not stock-managed, skipped: Key cutting, Lockout");
  });

  it("has no warning when nothing was skipped", () => {
    expect(movementMessages("move", transfer({ skippedItems: [] })).warning).toBeUndefined();
  });
});

describe("toLocations", () => {
  const warehouses: Warehouse[] = [
    { id: "w1", name: "Main", description: "Dallas yard", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" },
  ];
  const containers: Container[] = [
    {
      id: "c1",
      name: "Van 7",
      description: "Ford Transit",
      technicianId: "u7",
      technicianName: "Taras",
      department: "North",
      status: InventoryStatus.ARCHIVED,
      createdAt: "",
      updatedAt: "",
    },
    // Written before containers had names: the technician names it.
    { id: "c2", name: "", technicianName: "Pavlo", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" },
  ];

  it("lists warehouses first, then containers, keeping what a picker shows", () => {
    expect(toLocations(warehouses, containers)).toEqual([
      { type: "warehouse", id: "w1", name: "Main", description: "Dallas yard", status: "active" },
      {
        type: "container",
        id: "c1",
        name: "Van 7",
        description: "Ford Transit",
        status: "archived",
        technicianId: "u7",
        technicianName: "Taras",
        department: "North",
      },
      {
        type: "container",
        id: "c2",
        name: "Pavlo",
        description: undefined,
        status: "active",
        technicianId: undefined,
        technicianName: "Pavlo",
        department: undefined,
      },
    ]);
  });
});

describe("stockSummary — the three cards of the Manage stock popup", () => {
  it("multiplies what is on hand by cost and by price, Workiz-style", () => {
    expect(stockSummary(369, { costCompany: 20.16, priceClient: 45 })).toEqual({
      onHand: "369.00",
      cost: "$7439.04",
      sale: "$16605.00",
    });
  });

  it("rounds to the cent and says zero plainly", () => {
    expect(stockSummary(3, { costCompany: 0.335, priceClient: 1.1 })).toEqual({
      onHand: "3.00",
      cost: "$1.01",
      sale: "$3.30",
    });
    expect(stockSummary(0, { costCompany: 12, priceClient: 30 })).toEqual({
      onHand: "0.00",
      cost: "$0.00",
      sale: "$0.00",
    });
  });
});

describe("locationCards — the three cards of a warehouse's or van's popup", () => {
  const summary = { skuCount: 12, totalUnits: 1244, totalValue: 16605, lowCount: 1 };

  it("counts SKUs and units and prices the lot, Workiz-style", () => {
    expect(locationCards(summary, true)).toEqual({ skus: "12", units: "1244", value: "$16605.00" });
  });

  it("has no value to show while a row has no price — not a $0.00", () => {
    expect(locationCards(summary, false)).toEqual({ skus: "12", units: "1244", value: "—" });
  });

  it("says zero plainly for an empty location", () => {
    expect(locationCards({ skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 }, true)).toEqual({
      skus: "0",
      units: "0",
      value: "$0.00",
    });
  });
});

describe("checkQuantity", () => {
  it("takes a whole number from 1 up to what the location holds", () => {
    expect(checkQuantity("1", 4)).toEqual({ quantity: 1, error: null });
    expect(checkQuantity(" 4 ", 4)).toEqual({ quantity: 4, error: null });
    expect(checkQuantity("250")).toEqual({ quantity: 250, error: null });
  });

  it("says nothing while the field is empty — the button is simply off", () => {
    expect(checkQuantity("", 4)).toEqual({ quantity: null, error: null });
  });

  it("refuses more than the location holds", () => {
    expect(checkQuantity("5", 4)).toEqual({ quantity: null, error: "Only 4 available" });
  });

  it("refuses zero, negatives and fractions", () => {
    expect(checkQuantity("0")).toEqual({ quantity: null, error: "Enter 1 or more" });
    expect(checkQuantity("-2")).toEqual({ quantity: null, error: "Enter 1 or more" });
    expect(checkQuantity("1.5")).toEqual({ quantity: null, error: "Whole units only" });
    expect(checkQuantity("abc")).toEqual({ quantity: null, error: "Whole units only" });
  });
});

describe("filterStockRows", () => {
  const rows = [
    { name: "Main warehouse", description: "Dallas yard" },
    { name: "Taras's van", description: "Ford Transit" },
    { name: "Pavlo's van" },
  ];

  it("matches the name or the description, ignoring case", () => {
    expect(filterStockRows(rows, "VAN").map((r) => r.name)).toEqual(["Taras's van", "Pavlo's van"]);
    expect(filterStockRows(rows, "transit").map((r) => r.name)).toEqual(["Taras's van"]);
  });

  it("keeps every row for a blank search", () => {
    expect(filterStockRows(rows, "  ")).toBe(rows);
  });
});

describe("filterItemRows — a location popup's search", () => {
  const rows = [
    { name: "Deadbolt", sku: "LOCK-001" },
    { name: "Key blank", sku: "KEY-7" },
    { name: "Strike plate" },
  ];

  it("matches the item's name or SKU, ignoring case", () => {
    expect(filterItemRows(rows, "lock").map((r) => r.name)).toEqual(["Deadbolt"]);
    expect(filterItemRows(rows, "BLANK").map((r) => r.name)).toEqual(["Key blank"]);
    expect(filterItemRows(rows, "key-7").map((r) => r.name)).toEqual(["Key blank"]);
  });

  it("keeps every row for a blank search", () => {
    expect(filterItemRows(rows, " ")).toBe(rows);
  });
});

describe("pageSlice — client paging over the whole list", () => {
  const rows = Array.from({ length: 93 }, (_, i) => i + 1);

  it("cuts the page and says where it sits", () => {
    expect(pageSlice(rows, 1, 10)).toEqual({
      rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      page: 1,
      pages: 10,
      from: 1,
      to: 10,
      total: 93,
    });
    const last = pageSlice(rows, 10, 10);
    expect(last.rows).toEqual([91, 92, 93]);
    expect(last).toMatchObject({ from: 91, to: 93, pages: 10 });
  });

  it("pulls a page past the end back to the last one", () => {
    expect(pageSlice(rows, 12, 50)).toMatchObject({ page: 2, from: 51, to: 93, pages: 2 });
  });

  it("has one empty page when there is nothing", () => {
    expect(pageSlice([], 3, 10)).toEqual({ rows: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
  });
});

describe("moveTargets", () => {
  const active = InventoryStatus.ACTIVE;
  const locations: StockLocation[] = [
    { type: "warehouse", id: "w1", name: "Main", status: active },
    { type: "warehouse", id: "w2", name: "Old yard", status: InventoryStatus.ARCHIVED },
    { type: "container", id: "c1", name: "Taras's van", status: active, technicianName: "Taras" },
    { type: "container", id: "c2", name: "Pavlo's van", status: active, department: "North" },
    // Same id as a warehouse: only the type tells them apart.
    { type: "container", id: "w1", name: "Spare van", status: active },
  ];

  it("offers every other active location, warehouses and containers apart", () => {
    const t = moveTargets(locations, { type: "container", id: "c1" });
    expect(t.warehouses.map((l) => l.id)).toEqual(["w1"]);
    expect(t.containers.map((l) => l.name)).toEqual(["Pavlo's van", "Spare van"]);
  });

  it("leaves out the source by type and id", () => {
    const t = moveTargets(locations, { type: "warehouse", id: "w1" });
    expect(t.warehouses).toEqual([]);
    expect(t.containers.map((l) => l.name)).toContain("Spare van");
  });
});

describe("locationHint", () => {
  it("names the van's technician and department", () => {
    expect(
      locationHint({ type: "container", id: "c1", name: "Van 7", status: InventoryStatus.ACTIVE, technicianName: "Taras", department: "North" }),
    ).toBe("Taras · North");
    expect(locationHint({ type: "warehouse", id: "w1", name: "Main", status: InventoryStatus.ACTIVE })).toBe("");
  });

  it("does not repeat a technician the name already carries", () => {
    expect(
      locationHint({ type: "container", id: "c2", name: "Pavlo", status: InventoryStatus.ACTIVE, technicianName: "Pavlo" }),
    ).toBe("");
  });
});

/** F2's rows arrive named and priced; the views read them as stock rows. */
describe("stockRowsOf", () => {
  it("takes the name, SKU, category and price the server sent, and values the row", () => {
    expect(
      stockRowsOf([
        { productId: "p1", productName: "Deadbolt", sku: "LOCK-001", category: "Locks", quantity: 6, priceClient: 45 },
      ]),
    ).toEqual([
      {
        productId: "p1",
        name: "Deadbolt",
        sku: "LOCK-001",
        category: "Locks",
        quantity: 6,
        unitPrice: 45,
        value: 270,
        minLevel: undefined,
        isLow: false,
      },
    ]);
  });

  it("leaves value unknown without a price", () => {
    const [row] = stockRowsOf([{ productId: "p1", productName: "Deadbolt", quantity: 2 }]);
    expect(row.unitPrice).toBeUndefined();
    expect(row.value).toBeUndefined();
  });

  it("keeps the server's order — it already sorts by name", () => {
    const rows = stockRowsOf([
      { productId: "p2", productName: "Strike plate", quantity: 1 },
      { productId: "p1", productName: "Deadbolt", quantity: 1 },
    ]);
    expect(rows.map((r) => r.productId)).toEqual(["p2", "p1"]);
  });

  it("marks a row low only against a minimum the row carries", () => {
    const [low, fine, none] = stockRowsOf([
      { productId: "p1", productName: "A", quantity: 2, minimumStockLevel: 5 },
      { productId: "p2", productName: "B", quantity: 9, minimumStockLevel: 5 },
      { productId: "p3", productName: "C", quantity: 1 },
    ]);
    expect([low.isLow, fine.isLow, none.isLow]).toEqual([true, false, false]);
  });
});
