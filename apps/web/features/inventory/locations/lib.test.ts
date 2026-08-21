import { describe, it, expect } from "vitest";
import { InventoryStatus, type Container, type Warehouse } from "@bitcrm/types";
import {
  toLocationRows,
  searchLocations,
  vanDescription,
  summarizeStockValue,
} from "./lib";

const warehouse = (over: Partial<Warehouse>): Warehouse => ({
  id: "w-1",
  name: "STORE",
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const container = (over: Partial<Container>): Container => ({
  id: "c-1",
  technicianId: "u-1",
  technicianName: "Eli Szender",
  department: "CT",
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("vanDescription", () => {
  it("spells the van out instead of cramming it into free text", () => {
    // Workiz has no van fields at all — VIN, plate and state are typed into the
    // location's description by hand. Ours are structured, so we format them.
    expect(
      vanDescription({
        year: 2021,
        make: "Nissan",
        model: "NV200",
        vin: "3N6CM0KN1MK697538",
        licensePlate: "C028196",
      }),
    ).toBe("2021 Nissan NV200 · VIN 3N6CM0KN1MK697538 · Plate C028196");
  });

  it("skips the parts that aren't filled in", () => {
    expect(vanDescription({ licensePlate: "C028196" })).toBe("Plate C028196");
    expect(vanDescription({ make: "Ford", model: "Transit" })).toBe("Ford Transit");
  });

  it("is blank when no van is attached yet", () => {
    expect(vanDescription(undefined)).toBe("");
    expect(vanDescription({})).toBe("");
  });
});

describe("toLocationRows", () => {
  it("mixes warehouses and containers into one table, warehouses first", () => {
    const rows = toLocationRows(
      [warehouse({ id: "w-2", name: "Overflow" }), warehouse({ id: "w-1", name: "STORE" })],
      [
        container({ id: "c-2", name: "(AZ) Zack" }),
        container({ id: "c-1", name: "(AZ) Eli Szender" }),
      ],
    );

    expect(rows.map((r) => r.name)).toEqual([
      "Overflow",
      "STORE",
      "(AZ) Eli Szender",
      "(AZ) Zack",
    ]);
    expect(rows.map((r) => r.kind)).toEqual([
      "warehouse",
      "warehouse",
      "container",
      "container",
    ]);
  });

  it("links each row to the right detail page", () => {
    const [w, c] = toLocationRows([warehouse({ id: "w-1" })], [container({ id: "c-1" })]);

    expect(w.href).toBe("/inventory/warehouses/w-1");
    expect(c.href).toBe("/inventory/containers/c-1");
  });

  it("falls back to the technician's name when a container is unnamed", () => {
    const [row] = toLocationRows([], [container({ name: undefined })]);
    expect(row.name).toBe("Eli Szender");
  });

  it("describes a warehouse by its description, or its address when there is none", () => {
    const rows = toLocationRows(
      [
        warehouse({ id: "w-1", name: "A", description: "Main shelf room" }),
        warehouse({ id: "w-2", name: "B", address: "12 Elm St" }),
      ],
      [],
    );
    expect(rows.map((r) => r.description)).toEqual(["Main shelf room", "12 Elm St"]);
  });

  it("carries the archived flag so the row can say 'Not in use'", () => {
    // Workiz prefixes the name with "N/A " instead; we keep the name clean and
    // put the state in a badge.
    const [row] = toLocationRows([warehouse({ status: InventoryStatus.ARCHIVED })], []);
    expect(row.active).toBe(false);
    expect(row.name).toBe("STORE");
  });

  it("survives both lists still loading", () => {
    expect(toLocationRows(undefined, undefined)).toEqual([]);
  });
});

describe("searchLocations", () => {
  const rows = toLocationRows(
    [warehouse({ id: "w-1", name: "STORE", description: "Main shelf room" })],
    [container({ id: "c-1", name: "(AZ) Eli Szender", van: { licensePlate: "C028196" } })],
  );

  it("matches the name", () => {
    expect(searchLocations(rows, "eli").map((r) => r.id)).toEqual(["c-1"]);
  });

  it("matches the description, so a plate finds its van", () => {
    expect(searchLocations(rows, "c028196").map((r) => r.id)).toEqual(["c-1"]);
  });

  it("returns everything for a blank query", () => {
    expect(searchLocations(rows, "")).toHaveLength(2);
  });
});

describe("summarizeStockValue", () => {
  it("totals on-hand units, cost and sale value", () => {
    const totals = summarizeStockValue([
      { quantity: 3, cost: 4.5, price: 9.99 },
      { quantity: 2, cost: 1.25, price: 3.5 },
    ]);

    expect(totals.onHand).toBe(5);
    expect(totals.totalCost).toBe(16);
    expect(totals.saleValue).toBe(36.97);
  });

  it("adds money in cents — Workiz shows 7256.822500000001 on this screen", () => {
    const totals = summarizeStockValue([
      { quantity: 1, cost: 8.15, price: 0 },
      { quantity: 1, cost: 8.15, price: 0 },
      { quantity: 1, cost: 8.15, price: 0 },
    ]);

    expect(totals.totalCost).toBe(24.45);
  });

  it("treats a missing price or cost as zero rather than NaN", () => {
    const totals = summarizeStockValue([{ quantity: 2 }]);
    expect(totals).toEqual({ onHand: 2, totalCost: 0, saleValue: 0 });
  });
});
