import { describe, expect, it } from "vitest";
import { ESTIMATE_STATUSES, type Estimate, type EstimateItem } from "@bitcrm/types";
import {
  ESTIMATE_STATUS_META,
  buildEstimateListQuery,
  estimateLocalTotals,
  estimateStatusLabel,
  estimateTitle,
  itemBodyFrom,
  normalizeEstimateSummary,
  reorderLineIds,
  syncBlockReason,
  syncConfirmText,
} from "./lib";

describe("estimate status meta", () => {
  it("labels every status", () => {
    expect(ESTIMATE_STATUSES.map(estimateStatusLabel)).toEqual([
      "Unsent", "Pending", "Approved", "Declined", "Won", "Archived",
    ]);
    for (const s of ESTIMATE_STATUSES) expect(ESTIMATE_STATUS_META[s].className).toBeTruthy();
  });
});

describe("normalizeEstimateSummary", () => {
  const zero = { count: 0, amount: 0 };

  it("accepts a status-keyed map", () => {
    const r = normalizeEstimateSummary({ pending: { count: 2, amount: 150 } });
    expect(r.pending).toEqual({ count: 2, amount: 150 });
    expect(r.won).toEqual(zero);
  });

  it("accepts a nested byStatus map and an array of rows", () => {
    expect(normalizeEstimateSummary({ byStatus: { won: { count: 1, amount: 9 } } }).won).toEqual({ count: 1, amount: 9 });
    expect(normalizeEstimateSummary([{ status: "declined", count: 3, amount: 20 }]).declined).toEqual({ count: 3, amount: 20 });
  });

  it("accepts parallel counts/amounts and xCount/xAmount keys", () => {
    expect(normalizeEstimateSummary({ counts: { approved: 4 }, amounts: { approved: 40 } }).approved).toEqual({ count: 4, amount: 40 });
    expect(normalizeEstimateSummary({ unsentCount: 5, unsentAmount: 50 }).unsent).toEqual({ count: 5, amount: 50 });
  });

  it("degrades to zeros for junk", () => {
    expect(normalizeEstimateSummary(null).archived).toEqual(zero);
    expect(normalizeEstimateSummary({ pending: "x" }).pending).toEqual(zero);
  });

  it("totals the all bucket", () => {
    const r = normalizeEstimateSummary({ pending: { count: 2, amount: 10 }, won: { count: 1, amount: 5 } });
    expect(r.all).toEqual({ count: 3, amount: 15 });
  });
});

describe("sync rules", () => {
  it("blocks without permission, items, or when archived", () => {
    expect(syncBlockReason({ status: "pending" }, 2, false)).toMatch(/permission/i);
    expect(syncBlockReason({ status: "pending" }, 0, true)).toMatch(/at least one item/i);
    expect(syncBlockReason({ status: "archived" }, 2, true)).toMatch(/archived/i);
    expect(syncBlockReason({ status: "approved" }, 2, true)).toBeNull();
  });

  it("explains what the sync replaces", () => {
    expect(syncConfirmText(3, 1)).toBe(
      "This replaces the job's 3 current items with the estimate's 1 item. Parts are pulled from the assigned technician's stock when available, otherwise marked to order.",
    );
    expect(syncConfirmText(1, 2)).toMatch(/job's 1 current item with the estimate's 2 items/);
  });
});

describe("estimateLocalTotals", () => {
  it("runs the shared formula, with no tax for exempt clients", () => {
    const items = [
      { quantity: 2, priceClient: 50, taxable: true },
      { quantity: 1, priceClient: 20, taxable: false },
    ] as EstimateItem[];
    const e = { taxRatePercent: 10, discount: undefined, taxSource: "manual" } as Estimate;
    expect(estimateLocalTotals(e, items).total).toBe(130);
    expect(estimateLocalTotals({ ...e, taxSource: "exempt" }, items).total).toBe(120);
  });
});

describe("reorderLineIds", () => {
  it("moves a line to a new slot", () => {
    expect(reorderLineIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderLineIds(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
    expect(reorderLineIds(["a", "b"], "a", "zzz")).toEqual(["a", "b"]);
  });
});

describe("misc", () => {
  it("titles an estimate by number and name", () => {
    expect(estimateTitle({ number: "1042-1" })).toBe("Estimate #1042-1");
    expect(estimateTitle({ number: "1042-2", name: "Good" })).toBe("Estimate #1042-2 · Good");
  });

  it("builds list queries", () => {
    expect(buildEstimateListQuery({})).toBe("");
    expect(buildEstimateListQuery({ status: "won", contactId: "c1", limit: 25, cursor: "x" })).toBe(
      "?status=won&contactId=c1&limit=25&cursor=x",
    );
  });

  it("copies an item's editable fields into a request body", () => {
    const item = {
      lineId: "l1", estimateId: "e1", position: 0, productId: "p1", name: "Lock", sku: "L-1",
      quantity: 2, priceClient: 10, costCompany: 4, costForTech: 5, taxable: false,
      createdAt: "", updatedAt: "",
    } as EstimateItem;
    expect(itemBodyFrom(item, { quantity: 3 })).toEqual({
      productId: "p1", productType: undefined, name: "Lock", sku: "L-1", description: undefined,
      quantity: 3, priceClient: 10, costCompany: 4, costForTech: 5, taxable: false,
    });
  });
});
