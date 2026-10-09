import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { filterStockRows, isClosedJob, sortStockRows, techActionState } from "./lib";

describe("isClosedJob", () => {
  it("is done, done pending approval and canceled — nothing else", () => {
    expect(isClosedJob({ superStatus: JobSuperStatus.DONE })).toBe(true);
    expect(isClosedJob({ superStatus: JobSuperStatus.DONE_PENDING_APPROVAL })).toBe(true);
    expect(isClosedJob({ superStatus: JobSuperStatus.CANCELED })).toBe(true);
    expect(isClosedJob({ superStatus: JobSuperStatus.PENDING })).toBe(false);
  });
});

describe("techActionState", () => {
  it("offers the whole flow on a fresh Submitted job", () => {
    expect(techActionState({ superStatus: JobSuperStatus.SUBMITTED })).toEqual({
      canConfirm: true,
      canNotify: true,
      canArrive: true,
      canStart: true,
      canFinish: false,
    });
  });

  it("hides confirm and arrived once they have happened, and offers Done while in progress", () => {
    expect(
      techActionState({ superStatus: JobSuperStatus.IN_PROGRESS, techConfirmedAt: "x", arrivedAt: "y" }),
    ).toEqual({ canConfirm: false, canNotify: true, canArrive: false, canStart: false, canFinish: true });
  });

  it("offers nothing on a closed job", () => {
    expect(techActionState({ superStatus: JobSuperStatus.DONE })).toEqual({
      canConfirm: false,
      canNotify: false,
      canArrive: false,
      canStart: false,
      canFinish: false,
    });
  });
});

describe("stock search", () => {
  const rows = [
    { productId: "p1", name: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 2, isLow: true },
    { productId: "p2", name: "Key blank", sku: "KEY-1", category: "Keys", quantity: 120, isLow: false },
    { productId: "p3", name: "Cylinder", category: "Locks", quantity: 8, isLow: false },
  ];

  it("returns everything for an empty query", () => {
    expect(filterStockRows(rows, "  ")).toHaveLength(3);
  });

  it("matches on name, SKU or category, case-insensitively", () => {
    expect(filterStockRows(rows, "dead").map((r) => r.productId)).toEqual(["p1"]);
    expect(filterStockRows(rows, "key-1").map((r) => r.productId)).toEqual(["p2"]);
    expect(filterStockRows(rows, "LOCKS").map((r) => r.productId)).toEqual(["p1", "p3"]);
  });

  it("requires every word, but lets them come from different fields", () => {
    expect(filterStockRows(rows, "locks dead").map((r) => r.productId)).toEqual(["p1"]);
    expect(filterStockRows(rows, "locks nothing")).toEqual([]);
  });

  it("ignores a row with no SKU rather than throwing", () => {
    expect(filterStockRows(rows, "cylinder").map((r) => r.productId)).toEqual(["p3"]);
  });

  it("floats low stock to the top, then sorts by name", () => {
    expect(sortStockRows(rows).map((r) => r.productId)).toEqual(["p1", "p3", "p2"]);
  });

  it("does not mutate the list it was given", () => {
    const original = [...rows];
    sortStockRows(rows);
    expect(rows).toEqual(original);
  });
});
