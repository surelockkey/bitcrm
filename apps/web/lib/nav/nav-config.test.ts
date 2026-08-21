import { describe, it, expect } from "vitest";
import { MAIN_NAV, visibleNavItems } from "./nav-config";

const work = MAIN_NAV.find((g) => g.label === "Work")!;

describe("visibleNavItems", () => {
  it("keeps available, permitted items and hides coming-soon ones by default", () => {
    // Work has Deals, Dispatch Map and Schedule — all available now.
    const items = visibleNavItems(work.items, () => true);
    expect(items.map((i) => i.label)).toEqual(["Jobs", "Dispatch Map", "Schedule"]);
  });

  it("hides items the user cannot view", () => {
    const items = visibleNavItems(work.items, () => false);
    expect(items).toEqual([]);
  });
});

describe("visibleNavItems with an any-of gate", () => {
  const inventory = MAIN_NAV.find((g) => g.label === "Inventory")!;
  const locations = inventory.items.find((i) => i.label === "Locations")!;

  it("shows Locations to someone who can only see containers", () => {
    // The screen mixes warehouses and vans; either half is reason enough to open it.
    const items = visibleNavItems([locations], (r) => r === "containers");
    expect(items.map((i) => i.label)).toEqual(["Locations"]);
  });

  it("hides it when the user can see neither", () => {
    expect(visibleNavItems([locations], () => false)).toEqual([]);
  });
});
