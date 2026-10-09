import { describe, expect, it } from "vitest";
import { inventoryTabCounts } from "./tab-counts";

/**
 * Workiz prints a counter beside every Inventory tab (Inventory 99+, User
 * locations 99+, Locations 94). Ours come from the tabs' own count reads, and
 * they are drawn only once all of them have answered — never one by one.
 */
describe("inventoryTabCounts", () => {
  const answered = (total: number) => ({ total, settled: true });

  it("gives each tab the total its count answered", () => {
    expect(
      inventoryTabCounts({
        items: answered(3106),
        warehouses: answered(3),
        containers: answered(91),
        "user-containers": answered(120),
        templates: answered(1),
        transfers: answered(0),
      }),
    ).toEqual({
      settled: true,
      counts: { items: 3106, warehouses: 3, containers: 91, "user-containers": 120, templates: 1, transfers: 0 },
    });
  });

  it("is not settled while any count is still on its way", () => {
    const view = inventoryTabCounts({ items: answered(5), containers: { settled: false } });
    expect(view.settled).toBe(false);
    expect(view.counts).toEqual({ items: 5 });
  });

  it("leaves a tab without a counter when its count failed or was never asked", () => {
    const view = inventoryTabCounts({ items: { settled: true }, transfers: answered(12) });
    expect(view).toEqual({ settled: true, counts: { transfers: 12 } });
  });
});
