import { describe, it, expect } from "vitest";
import { MAIN_NAV, visibleNavItems } from "./nav-config";
import type { Resource } from "@bitcrm/types";

const work = MAIN_NAV.find((g) => g.label === "Work")!;

describe("MAIN_NAV structure", () => {
  it("has a single Inventory entry in Work instead of an Inventory group", () => {
    expect(MAIN_NAV.find((g) => g.label === "Inventory")).toBeUndefined();

    const inventory = work.items.find((i) => i.label === "Inventory")!;
    expect(inventory).toBeDefined();
    expect(inventory.href).toBe("/inventory");
    // Visible if the user can view any of the inventory resources.
    expect(inventory.resources).toEqual([
      "products",
      "warehouses",
      "containers",
      "transfers",
    ]);
  });
});

describe("visibleNavItems", () => {
  it("keeps available, permitted items and hides coming-soon ones by default", () => {
    const items = visibleNavItems(work.items, () => true);
    expect(items.map((i) => i.label)).toEqual([
      "Jobs",
      "Dispatch Map",
      "Schedule",
      "Inventory",
    ]);
  });

  it("hides items the user cannot view", () => {
    const items = visibleNavItems(work.items, () => false);
    expect(items).toEqual([]);
  });

  it("shows a multi-resource item when any one resource is viewable", () => {
    const items = visibleNavItems(work.items, (r: Resource) => r === "warehouses");
    expect(items.map((i) => i.label)).toEqual(["Inventory"]);
  });

  it("hides a multi-resource item when none of its resources are viewable", () => {
    const items = visibleNavItems(work.items, (r: Resource) => r === "deals");
    expect(items.map((i) => i.label)).toEqual([
      "Jobs",
      "Dispatch Map",
      "Schedule",
    ]);
  });
});
