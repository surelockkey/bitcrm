import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Deal, DealProduct, DocumentTotals } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { applyLineWrite, restoreLineCache, snapshotLineCache } from "./line-cache";

/**
 * A line write (add, edit, remove) moves three cached answers at once — the
 * job's lines, the job itself (its item count and money snapshot, what the
 * tab strip prints) and the totals under the table — so the page shows one
 * frame, not three, and never waits for a reread to do it.
 */
const line = (over: Partial<DealProduct> = {}): DealProduct => ({
  lineId: "l1",
  productId: "p1",
  name: "Deadbolt",
  sku: "KW-1",
  quantity: 2,
  costCompany: 7,
  costForTech: 0,
  priceClient: 50,
  fulfillment: "to_order",
  taxable: true,
  addedBy: "u1",
  addedAt: "",
  ...over,
});

const deal = (over: Partial<Deal> = {}): Deal =>
  ({
    id: "d1",
    dealNumber: "K4T9ZW",
    assignedTechIds: [],
    taxRatePercent: 10,
    itemCount: 1,
    totals: { subtotal: 100, discount: 0, tax: 10, total: 110, cost: 14, taxableBase: 100 },
    companyCost: 14,
    ...over,
  }) as Deal;

function client() {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.deals.products("d1"), [line()]);
  qc.setQueryData(queryKeys.deals.detail("d1"), deal());
  qc.setQueryData<DocumentTotals>(queryKeys.dealTotals("d1"), {
    lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
    taxableBase: 100, taxRatePercent: 10, tax: 10, total: 110, amountPaid: 0, balanceDue: 110,
  });
  return qc;
}

describe("applyLineWrite", () => {
  it("appends a line and moves the job's count, money snapshot, Company Cost and the totals with it", () => {
    const qc = client();
    const added = line({ lineId: "l2", productId: "p2", quantity: 1, priceClient: 30, costCompany: 3, taxable: false });

    const lines = applyLineWrite(qc, "d1", (old) => [...old, added]);

    expect(lines.map((l) => l.lineId)).toEqual(["l1", "l2"]);
    expect(qc.getQueryData(queryKeys.deals.products("d1"))).toEqual(lines);
    const d = qc.getQueryData<Deal>(queryKeys.deals.detail("d1"))!;
    expect(d.itemCount).toBe(2);
    // 100 + 30 = 130, tax 10 % of the taxable 100 = 10 → 140; cost 2×7 + 1×3 = 17
    expect(d.totals).toMatchObject({ subtotal: 130, tax: 10, total: 140, cost: 17 });
    expect(d.companyCost).toBe(17);
    expect(qc.getQueryData<DocumentTotals>(queryKeys.dealTotals("d1"))).toMatchObject({ lineCount: 2, subtotal: 130, tax: 10, total: 140, balanceDue: 140 });
  });

  it("removes a line the same way; the last one going leaves the Company Cost at 0 (the lines gave it)", () => {
    const qc = client();

    applyLineWrite(qc, "d1", (old) => old.filter((l) => l.lineId !== "l1"));

    const d = qc.getQueryData<Deal>(queryKeys.deals.detail("d1"))!;
    expect(d.itemCount).toBe(0);
    expect(d.totals).toMatchObject({ subtotal: 0, tax: 0, total: 0, cost: 0 });
    expect(d.companyCost).toBe(0);
    expect(qc.getQueryData<DocumentTotals>(queryKeys.dealTotals("d1"))).toMatchObject({ lineCount: 0, total: 0 });
  });

  it("keeps a Company Cost typed over the lines' sum when the last line goes, as the server does", () => {
    const qc = client();
    qc.setQueryData(queryKeys.deals.detail("d1"), deal({ companyCost: 20 }));

    applyLineWrite(qc, "d1", () => []);

    expect(qc.getQueryData<Deal>(queryKeys.deals.detail("d1"))!.companyCost).toBe(20);
  });

  it("replaces an edited line in place and keeps the job's discount in the money", () => {
    const qc = client();
    qc.setQueryData(queryKeys.deals.detail("d1"), deal({ discount: { type: "amount", value: 10 } }));

    applyLineWrite(qc, "d1", (old) => old.map((l) => (l.lineId === "l1" ? { ...l, quantity: 3 } : l)));

    const d = qc.getQueryData<Deal>(queryKeys.deals.detail("d1"))!;
    // 3 × 50 = 150 − 10 = 140, tax 10 % of 140 = 14 → 154
    expect(d.totals).toMatchObject({ subtotal: 150, discount: 10, tax: 14, total: 154, cost: 21 });
  });

  it("touches only the lines when the job itself is not cached yet", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.deals.products("d1"), [line()]);

    const lines = applyLineWrite(qc, "d1", () => []);

    expect(lines).toEqual([]);
    expect(qc.getQueryData(queryKeys.deals.detail("d1"))).toBeUndefined();
    expect(qc.getQueryData(queryKeys.dealTotals("d1"))).toBeUndefined();
  });

  it("starts from no lines when none are cached", () => {
    const qc = new QueryClient();
    expect(applyLineWrite(qc, "d1", (old) => [...old, line()])).toHaveLength(1);
  });
});

describe("snapshotLineCache / restoreLineCache", () => {
  it("puts the three answers back as they were — a refused remove", () => {
    const qc = client();
    const snap = snapshotLineCache(qc, "d1");
    applyLineWrite(qc, "d1", () => []);

    restoreLineCache(qc, "d1", snap);

    expect(qc.getQueryData<DealProduct[]>(queryKeys.deals.products("d1"))).toHaveLength(1);
    expect(qc.getQueryData<Deal>(queryKeys.deals.detail("d1"))!.itemCount).toBe(1);
    expect(qc.getQueryData<DocumentTotals>(queryKeys.dealTotals("d1"))!.total).toBe(110);
  });
});
