import { describe, it, expect } from "vitest";
import { MAIN_NAV, visibleNavItems } from "./nav-config";

const work = MAIN_NAV.find((g) => g.label === "Work")!;

describe("visibleNavItems", () => {
  it("keeps available, permitted items and hides coming-soon ones by default", () => {
    // Work has Deals, Dispatch Map and Schedule — all available now.
    const items = visibleNavItems(work.items, () => true);
    expect(items.map((i) => i.label)).toEqual(["Deals", "Dispatch Map", "Schedule"]);
  });

  it("hides items the user cannot view", () => {
    const items = visibleNavItems(work.items, () => false);
    expect(items).toEqual([]);
  });
});
