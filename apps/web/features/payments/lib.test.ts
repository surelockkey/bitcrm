import { describe, expect, it } from "vitest";
import { MAX_SURCHARGE_PERCENT, calculateDocumentTotals, type Payment } from "@bitcrm/types";
import {
  OFFLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_META,
  PAYMENT_STATUS_META,
  SURCHARGE_WARNING,
  applyAmountPaid,
  availableOnlineMethods,
  buildPaymentListQuery,
  canRefund,
  isPartiallyPaid,
  overRefundMessage,
  parseMoney,
  paymentMethodLabel,
  paymentStatusLabel,
  refundAmountError,
  remainingRefundable,
  sameMethods,
  takenAtIso,
} from "./lib";

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "p1",
    invoiceId: "d1",
    dealId: "d1",
    contactId: "c1",
    amount: 100,
    currency: "usd",
    method: "card",
    status: "settled",
    refundedAmount: 0,
    source: "office",
    takenBy: "u1",
    takenAt: "2026-09-20T15:00:00.000Z",
    version: 1,
    createdAt: "2026-09-20T15:00:00.000Z",
    updatedAt: "2026-09-20T15:00:00.000Z",
    ...over,
  };
}

describe("labels", () => {
  it("names every status and method", () => {
    expect(paymentStatusLabel("settled")).toBe("Paid");
    expect(paymentStatusLabel("pending")).toBe("Clearing");
    expect(paymentStatusLabel("reversed")).toBe("Reversed");
    expect(paymentMethodLabel("bank")).toBe("Bank");
    expect(paymentMethodLabel("check")).toBe("Check");
    for (const meta of Object.values(PAYMENT_STATUS_META)) expect(meta.label).not.toBe("");
    for (const meta of Object.values(PAYMENT_METHOD_META)) expect(meta.icon).toBeTruthy();
  });

  it("offers only the methods staff can record by hand, card last-but-one", () => {
    expect(OFFLINE_PAYMENT_METHODS).toEqual(["cash", "check", "card", "other"]);
    expect(OFFLINE_PAYMENT_METHODS).not.toContain("bank");
  });
});

describe("remainingRefundable / canRefund", () => {
  it("is the gross less what has already gone back", () => {
    expect(remainingRefundable(payment({ amount: 100, refundedAmount: 25 }))).toBe(75);
    expect(remainingRefundable(payment({ amount: 0.3, refundedAmount: 0.1 }))).toBe(0.2);
  });

  it("is nothing for money that never settled or already came back", () => {
    expect(remainingRefundable(payment({ status: "pending" }))).toBe(0);
    expect(remainingRefundable(payment({ status: "failed" }))).toBe(0);
    expect(remainingRefundable(payment({ status: "reversed" }))).toBe(0);
    expect(remainingRefundable(payment({ status: "refunded", refundedAmount: 100 }))).toBe(0);
    expect(remainingRefundable(payment({ amount: 100, refundedAmount: 100 }))).toBe(0);
  });

  it("allows a refund only while something is left", () => {
    expect(canRefund(payment())).toBe(true);
    expect(canRefund(payment({ refundedAmount: 40 }))).toBe(true);
    expect(canRefund(payment({ refundedAmount: 100 }))).toBe(false);
    expect(canRefund(payment({ status: "pending" }))).toBe(false);
  });
});

describe("refundAmountError", () => {
  const p = payment({ amount: 100, refundedAmount: 20 });

  it("accepts an amount up to what remains", () => {
    expect(refundAmountError(p, "80")).toBeNull();
    expect(refundAmountError(p, "0.01")).toBeNull();
  });

  it("refuses nothing, a negative, and more than remains", () => {
    expect(refundAmountError(p, "")).toBe("Enter an amount to refund");
    expect(refundAmountError(p, "abc")).toBe("Enter an amount to refund");
    expect(refundAmountError(p, "0")).toBe("Enter an amount greater than $0.00");
    expect(refundAmountError(p, "-5")).toBe("Enter an amount greater than $0.00");
    expect(refundAmountError(p, "80.01")).toBe(overRefundMessage(80));
    expect(overRefundMessage(80)).toContain("$80.00");
  });

  it("refuses any amount on a payment that cannot be refunded", () => {
    expect(refundAmountError(payment({ status: "pending" }), "10")).toBe(
      "This payment can't be refunded",
    );
  });
});

describe("parseMoney", () => {
  it("reads a typed amount as dollars, rounded to cents", () => {
    expect(parseMoney("125.50")).toBe(125.5);
    expect(parseMoney(" 0.015 ")).toBe(0.02);
    expect(parseMoney("1000")).toBe(1000);
  });
});

describe("isPartiallyPaid", () => {
  it("is true only when some money landed and some is still owed", () => {
    expect(isPartiallyPaid(50, 50)).toBe(true);
    expect(isPartiallyPaid(0, 100)).toBe(false);
    expect(isPartiallyPaid(100, 0)).toBe(false);
    expect(isPartiallyPaid(100, -0.001)).toBe(false);
  });
});

describe("applyAmountPaid", () => {
  const totals = calculateDocumentTotals({ lines: [{ quantity: 1, priceClient: 100 }] });

  it("restates paid and balance due from the ledger, in cents", () => {
    const next = applyAmountPaid(totals, 33.33);
    expect(next.amountPaid).toBe(33.33);
    expect(next.balanceDue).toBe(66.67);
    expect(next.total).toBe(totals.total);
  });

  it("never reports a negative balance or a negative payment", () => {
    expect(applyAmountPaid(totals, 150).balanceDue).toBe(0);
    expect(applyAmountPaid(totals, -5).amountPaid).toBe(0);
  });
});

describe("takenAtIso", () => {
  it("keeps the clock time when the payment is recorded for today", () => {
    const now = new Date(2026, 8, 20, 9, 30);
    expect(takenAtIso("2026-09-20", now)).toBe(now.toISOString());
  });

  it("uses local midday for a back-dated payment so the day never slips", () => {
    const now = new Date(2026, 8, 20, 9, 30);
    expect(takenAtIso("2026-09-18", now)).toBe(new Date(2026, 8, 18, 12, 0, 0).toISOString());
  });

  it("falls back to now for a day it cannot read", () => {
    const now = new Date(2026, 8, 20, 9, 30);
    expect(takenAtIso("nonsense", now)).toBe(now.toISOString());
  });
});

describe("buildPaymentListQuery", () => {
  it("omits empty filters", () => {
    expect(buildPaymentListQuery({})).toBe("");
  });

  it("passes the report's filters straight through", () => {
    expect(
      buildPaymentListQuery({
        from: "2026-09-01",
        to: "2026-09-30",
        method: "card",
        status: "settled",
        contactId: "c1",
        limit: 50,
        cursor: "abc",
      }),
    ).toBe("?from=2026-09-01&to=2026-09-30&method=card&status=settled&contactId=c1&limit=50&cursor=abc");
  });
});

describe("SURCHARGE_WARNING", () => {
  it("explains why surcharging is off and what the cap is", () => {
    expect(SURCHARGE_WARNING).toContain(`${MAX_SURCHARGE_PERCENT}%`);
    expect(SURCHARGE_WARNING).toMatch(/bank/i);
  });
});

describe("availableOnlineMethods", () => {
  const on = { onlinePaymentsEnabled: true, cardEnabled: true, bankEnabled: true };

  it("offers what the account has switched on", () => {
    expect(availableOnlineMethods(on)).toEqual(["card", "bank"]);
    expect(availableOnlineMethods({ ...on, bankEnabled: false })).toEqual(["card"]);
    expect(availableOnlineMethods({ ...on, cardEnabled: false })).toEqual(["bank"]);
  });

  it("offers nothing while online payments are off, or unknown", () => {
    expect(availableOnlineMethods({ ...on, onlinePaymentsEnabled: false })).toEqual([]);
    expect(availableOnlineMethods(undefined)).toEqual([]);
  });
});

describe("sameMethods", () => {
  it("ignores order and treats absent as absent", () => {
    expect(sameMethods(["card", "bank"], ["bank", "card"])).toBe(true);
    expect(sameMethods(["card"], ["card", "bank"])).toBe(false);
    expect(sameMethods(undefined, undefined)).toBe(true);
    expect(sameMethods([], undefined)).toBe(false);
  });
});
