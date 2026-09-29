import { PublicApiError } from "./lib";
import { describe, expect, it } from "vitest";
import type { PortalPaymentOptions } from "@bitcrm/types";
import { MAX_STATUS_POLLS, checkAmount, computeTotals, confirmErrorCopy, methodChoices, outcomeCopy, parseAmount, payableOnline, round2, startErrorCopy } from "./payment-lib";

const options: PortalPaymentOptions = {
  invoiceId: "d1",
  number: "1042",
  amountDue: 120.5,
  amountPending: 0,
  currency: "usd",
  methods: ["card", "bank"],
  allowPartial: true,
  bankMinimum: 20,
  surchargePercent: 0,
  surchargeLabel: "Card processing fee",
  tipsEnabled: false,
  tipPresets: [],
};

describe("parseAmount", () => {
  it("reads what a customer actually types", () => {
    expect(parseAmount("120.50")).toBe(120.5);
    expect(parseAmount("$1,200.00")).toBe(1200);
    expect(parseAmount(" 50 ")).toBe(50);
    expect(parseAmount(".5")).toBe(0.5);
  });

  it("refuses anything that is not a plain positive number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-10")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
    expect(parseAmount(".")).toBeNull();
  });
});

describe("checkAmount", () => {
  it("accepts the full balance and anything under it", () => {
    expect(checkAmount("120.50", options)).toEqual({ amount: 120.5, error: null });
    expect(checkAmount("40", options)).toEqual({ amount: 40, error: null });
  });

  it("asks for an amount when the field is empty or unreadable", () => {
    expect(checkAmount("", options).error).toMatch(/enter an amount/i);
    expect(checkAmount("abc", options).amount).toBeNull();
  });

  it("refuses zero — 0 < x <= amountDue", () => {
    expect(checkAmount("0", options).error).toMatch(/greater than/i);
    expect(checkAmount("0.00", options).amount).toBeNull();
  });

  it("refuses more than the balance and names the balance", () => {
    const { amount, error } = checkAmount("500", options);
    expect(amount).toBeNull();
    expect(error).toContain("$120.50");
  });

  it("allows only the full balance when partial payment is off", () => {
    const strict = { ...options, allowPartial: false };
    expect(checkAmount("120.50", strict).error).toBeNull();
    expect(checkAmount("40", strict).error).toMatch(/full balance/i);
  });

  it("tolerates a hundredth of float drift on the full balance", () => {
    const odd = { ...options, amountDue: 0.1 + 0.2 };
    expect(checkAmount("0.30", odd).error).toBeNull();
  });
});

describe("computeTotals", () => {
  it("has no fee row while surcharging is off (the shipped default)", () => {
    expect(computeTotals(120.5, 0)).toEqual({ amount: 120.5, fee: 0, total: 120.5 });
  });

  it("adds the surcharge and rounds to cents exactly once", () => {
    expect(computeTotals(100, 3)).toEqual({ amount: 100, fee: 3, total: 103 });
    expect(computeTotals(120.5, 2.5)).toEqual({ amount: 120.5, fee: 3.01, total: 123.51 });
  });

  it("never charges a negative or silly fee", () => {
    expect(computeTotals(100, -5).fee).toBe(0);
    expect(computeTotals(100, 50).fee).toBe(3);
  });
});

describe("round2", () => {
  it("rounds half up without binary drift", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("methodChoices", () => {
  it("offers only what the invoice allows", () => {
    expect(methodChoices({ ...options, methods: ["card"] }, 100).map((c) => c.value)).toEqual(["card"]);
  });

  it("disables bank below the minimum and says what to do instead", () => {
    const bank = methodChoices(options, 10).find((c) => c.value === "bank");
    expect(bank?.disabled).toBe(true);
    expect(bank?.reason).toContain("$20.00");
    expect(methodChoices(options, 20).find((c) => c.value === "bank")?.disabled).toBe(false);
  });

  it("warns that bank money takes days, on the choice itself", () => {
    expect(methodChoices(options, 100).find((c) => c.value === "bank")?.description).toMatch(/2–4 business days/);
  });
});

describe("payableOnline", () => {
  it("is false with nothing owed, no methods, or a document that is not payable", () => {
    expect(payableOnline(options)).toBe(true);
    expect(payableOnline({ ...options, amountDue: 0 })).toBe(false);
    expect(payableOnline({ ...options, methods: [] })).toBe(false);
  });
});

describe("confirmErrorCopy", () => {
  it("keeps Stripe's own reason and adds the next step", () => {
    const copy = confirmErrorCopy("Your card was declined.");
    expect(copy.title).toMatch(/didn.t go through/i);
    expect(copy.detail).toContain("Your card was declined.");
    expect(copy.detail).toMatch(/nothing has been charged/i);
  });

  it("still says something useful with no message from Stripe", () => {
    expect(confirmErrorCopy(undefined).detail).toMatch(/try again|another card/i);
  });
});

describe("outcomeCopy", () => {
  it("promises an email, not a wait, for a bank transfer", () => {
    const copy = outcomeCopy("pending", 120.5);
    expect(copy.title).toMatch(/on its way/i);
    expect(copy.detail).toMatch(/2–4 business days/);
    expect(copy.detail).toMatch(/email you when it clears/i);
  });

  it("thanks the customer and names the amount when the money landed", () => {
    expect(outcomeCopy("settled", 120.5).detail).toContain("$120.50");
  });

  it("does not claim success when we stopped waiting", () => {
    expect(outcomeCopy("unknown", 10).detail).toMatch(/email/i);
  });
});

describe("polling budget", () => {
  it("is bounded — the webhook may simply be late", () => {
    expect(MAX_STATUS_POLLS).toBeLessThanOrEqual(10);
    expect(MAX_STATUS_POLLS).toBeGreaterThan(1);
  });
});

describe("startErrorCopy", () => {
  it("tells a customer whose payment is still clearing not to retry", () => {
    const copy = startErrorCopy(new PublicApiError(409, "nothing left to pay"));
    expect(copy).toMatch(/still clearing/i);
    expect(copy).not.toMatch(/try again/i);
  });

  it("treats a dead link as a dead link", () => {
    expect(startErrorCopy(new PublicApiError(410, "gone"))).toMatch(/reopen your link/i);
  });

  it("invites a retry on a network failure, and says nothing was charged", () => {
    const copy = startErrorCopy(new TypeError("fetch failed"));
    expect(copy).toMatch(/try again/i);
    expect(copy).toMatch(/nothing has been charged/i);
  });
});
