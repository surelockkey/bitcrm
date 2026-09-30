import { describe, it, expect } from "vitest";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate, ContainerTemplateDiff, ContainerTemplateDiffLine } from "@bitcrm/types";
import {
  addLine,
  checkLineQuantity,
  diffSummary,
  fillMessages,
  templateUnits,
  usedByCount,
} from "./lib";

const template = (over: Partial<ContainerTemplate> = {}): ContainerTemplate => ({
  id: "t1",
  name: "Standard van",
  items: [
    { productId: "p1", productName: "Deadbolt", sku: "LOCK-1", quantity: 4 },
    { productId: "p2", productName: "Key blank", sku: "KEY-7", quantity: 50 },
  ],
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const line = (over: Partial<ContainerTemplateDiffLine>): ContainerTemplateDiffLine => ({
  productId: "p1",
  productName: "Deadbolt",
  sku: "LOCK-1",
  target: 4,
  onHand: 1,
  missing: 3,
  ...over,
});

describe("templateUnits", () => {
  it("sums the target quantities", () => {
    expect(templateUnits(template())).toBe(54);
    expect(templateUnits(template({ items: [] }))).toBe(0);
  });
});

describe("usedByCount", () => {
  it("counts the vans whose template this is", () => {
    const vans = [{ templateId: "t1" }, { templateId: "t2" }, { templateId: "t1" }, {}];
    expect(usedByCount("t1", vans)).toBe(2);
    expect(usedByCount("t9", vans)).toBe(0);
  });
});

describe("diffSummary", () => {
  const diff = (lines: ContainerTemplateDiffLine[]): ContainerTemplateDiff => ({
    templateId: "t1",
    templateName: "Standard van",
    containerId: "c1",
    containerName: "Van 1",
    warehouseId: "w1",
    warehouseName: "Main",
    lines,
    shortLineCount: lines.filter((l) => l.missing > 0).length,
    missingUnits: lines.reduce((n, l) => n + l.missing, 0),
  });

  it("says how many lines and units are missing, and how many will move", () => {
    expect(
      diffSummary(
        diff([
          line({ missing: 3, available: 10, willMove: 3 }),
          line({ productId: "p2", missing: 20, available: 5, willMove: 5 }),
          line({ productId: "p3", missing: 0, available: 1, willMove: 0 }),
        ]),
      ),
    ).toEqual({ text: "2 lines missing, 23 units; 8 units will move", willMove: 8 });
  });

  it("speaks in the singular and says when the van is complete", () => {
    expect(diffSummary(diff([line({ missing: 1, available: 1, willMove: 1 })])).text).toBe(
      "1 line missing, 1 unit; 1 unit will move",
    );
    expect(diffSummary(diff([line({ missing: 0, available: 0, willMove: 0 })])).text).toBe(
      "Nothing missing — the van matches the template",
    );
  });
});

describe("fillMessages", () => {
  it("says how many units moved, and names what is still short", () => {
    expect(
      fillMessages({
        moved: [line({ willMove: 3 }), line({ productId: "p2", willMove: 5 })],
        short: [line({ productId: "p2", productName: "Key blank", missing: 20, willMove: 5 })],
      }, "Van 1"),
    ).toEqual({
      success: "Moved 8 units to Van 1",
      warning: "Still short: Key blank (15)",
    });
  });

  it("says plainly when nothing could move", () => {
    expect(fillMessages({ moved: [], short: [line({ willMove: 0 })] }, "Van 1")).toEqual({
      success: undefined,
      warning: "Nothing moved — still short: Deadbolt (3)",
    });
  });
});

describe("template lines", () => {
  const lines = [{ productId: "p1", productName: "Deadbolt", sku: "LOCK-1", quantity: "4" }];

  it("adds a product once", () => {
    const next = addLine(lines, { id: "p2", name: "Key blank", sku: "KEY-7" });
    expect(next.lines.map((l) => [l.productId, l.quantity])).toEqual([
      ["p1", "4"],
      ["p2", "1"],
    ]);
    expect(next.focus).toBe("p2");
  });

  // Adding a product already on the template points at its quantity instead.
  it("focuses the existing line instead of adding a duplicate", () => {
    const next = addLine(lines, { id: "p1", name: "Deadbolt", sku: "LOCK-1" });
    expect(next.lines).toBe(lines);
    expect(next.focus).toBe("p1");
  });

  it("takes a whole quantity of at least 1", () => {
    expect(checkLineQuantity("3")).toEqual({ quantity: 3, error: null });
    expect(checkLineQuantity("0").error).toBe("Enter 1 or more");
    expect(checkLineQuantity("1.5").error).toBe("Whole units only");
    expect(checkLineQuantity("").error).toBe("Enter a quantity");
  });
});
