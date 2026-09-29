import { describe, it, expect } from "vitest";
import { InventoryStatus, LocationType, TransferType } from "@bitcrm/types";
import type { Container, Transfer, Warehouse } from "@bitcrm/types";
import { movementMessages, toLocations } from "./lib";

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
