import { describe, expect, it } from "vitest";
import { markupPct, priceFromMarkup, amountOf, signedAmountOf, money2 } from "./line-item-math";

/**
 * Workiz "Add job item": Quantity · Price · Markup % · Cost in one row. The
 * markup is the price over the cost — 330 on a 35.18 cost is 838.03 % — and
 * typing a markup prices the line from its cost.
 */
describe("markupPct", () => {
  it("is the price over the cost, in percent, to 2 decimals (Workiz: 838.03)", () => {
    expect(markupPct(330, 35.18)).toBe(838.03);
    expect(markupPct(45, 30)).toBe(50);
  });

  it("is null without a positive cost — nothing to mark up", () => {
    expect(markupPct(330, 0)).toBeNull();
    expect(markupPct(330, -1)).toBeNull();
    expect(markupPct(330, Number.NaN)).toBeNull();
  });

  it("is negative when the line is sold under cost", () => {
    expect(markupPct(20, 40)).toBe(-50);
  });
});

describe("priceFromMarkup", () => {
  it("prices the line from its cost and the markup, to the cent", () => {
    expect(priceFromMarkup(35.18, 838.03)).toBe(330);
    expect(priceFromMarkup(30, 50)).toBe(45);
    expect(priceFromMarkup(10, 0)).toBe(10);
  });

  it("is null without a positive cost", () => {
    expect(priceFromMarkup(0, 50)).toBeNull();
  });
});

describe("amountOf / money2", () => {
  it("reads what was typed as a non-negative amount, else null", () => {
    expect(amountOf("12.5")).toBe(12.5);
    expect(amountOf("0")).toBe(0);
    expect(amountOf("")).toBeNull();
    expect(amountOf("abc")).toBeNull();
    expect(amountOf("-3")).toBeNull();
  });

  it("reads a price that may go below zero (a credit line), else null", () => {
    expect(signedAmountOf("-25")).toBe(-25);
    expect(signedAmountOf("-0.01")).toBe(-0.01);
    expect(signedAmountOf("12.5")).toBe(12.5);
    expect(signedAmountOf("")).toBeNull();
    expect(signedAmountOf("abc")).toBeNull();
  });

  it("prints a number with two decimals, as Workiz fills its boxes (330.00, 35.18)", () => {
    expect(money2(330)).toBe("330.00");
    expect(money2(35.18)).toBe("35.18");
    expect(money2(838.034)).toBe("838.03");
  });
});
