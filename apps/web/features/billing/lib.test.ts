import { describe, it, expect } from "vitest";
import type { TaxRate } from "@bitcrm/types";
import {
  discountLabel,
  formatPercent,
  isAutoTaxSource,
  normalizeDiscount,
  serviceAreaTaxLabel,
  taxRateLabel,
  taxSourceLabel,
  TAX_EXEMPT_REASONS,
} from "./lib";

const rate = (over: Partial<TaxRate> = {}): TaxRate => ({
  id: "r1",
  name: "State",
  ratePercent: 6,
  isDefault: false,
  active: true,
  isGroup: false,
  componentIds: [],
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("formatPercent", () => {
  it("drops trailing zeros and keeps up to 3 decimals", () => {
    expect(formatPercent(6)).toBe("6%");
    expect(formatPercent(6.35)).toBe("6.35%");
    expect(formatPercent(8.875)).toBe("8.875%");
    expect(formatPercent(7.12345)).toBe("7.123%");
  });
  it("treats non-finite input as 0", () => {
    expect(formatPercent(Number.NaN)).toBe("0%");
    expect(formatPercent(undefined)).toBe("0%");
  });
});

describe("taxSourceLabel / isAutoTaxSource", () => {
  it("describes every source", () => {
    expect(taxSourceLabel("service_area")).toMatch(/service area/i);
    expect(taxSourceLabel("default")).toMatch(/default/i);
    expect(taxSourceLabel("manual")).toMatch(/manual/i);
    expect(taxSourceLabel("exempt")).toMatch(/exempt/i);
    expect(taxSourceLabel("none")).toMatch(/no tax/i);
    expect(taxSourceLabel(undefined)).toMatch(/no tax/i);
  });
  it("only manual is not automatic", () => {
    expect(isAutoTaxSource("manual")).toBe(false);
    expect(isAutoTaxSource("service_area")).toBe(true);
    expect(isAutoTaxSource("default")).toBe(true);
    expect(isAutoTaxSource("exempt")).toBe(true);
    expect(isAutoTaxSource(undefined)).toBe(false);
  });
});

describe("taxRateLabel", () => {
  it("renders name, percent and the owning service area", () => {
    expect(
      taxRateLabel(rate({ name: "CT Sales Tax", ratePercent: 6.35, serviceAreaName: "Hartford" })),
    ).toBe("CT Sales Tax 6.35% · Hartford");
  });
  it("omits the area when unknown", () => {
    expect(taxRateLabel(rate({ name: "CA", ratePercent: 7.25 }))).toBe("CA 7.25%");
  });
});

describe("serviceAreaTaxLabel", () => {
  it("renders the area tax or No tax", () => {
    expect(serviceAreaTaxLabel({ name: "CT Sales Tax", ratePercent: 6.35 })).toBe("CT Sales Tax · 6.35%");
    expect(serviceAreaTaxLabel(undefined)).toBe("No tax");
  });
});

describe("discountLabel", () => {
  it("formats percent and amount discounts", () => {
    expect(discountLabel({ type: "percent", value: 10 })).toBe("10%");
    expect(discountLabel({ type: "amount", value: 5 })).toBe("$5.00");
    expect(discountLabel(undefined)).toBe("");
  });
});

describe("normalizeDiscount", () => {
  it("returns null for empty/zero/negative values", () => {
    expect(normalizeDiscount("amount", "")).toBeNull();
    expect(normalizeDiscount("amount", 0)).toBeNull();
    expect(normalizeDiscount("percent", -3)).toBeNull();
    expect(normalizeDiscount("percent", "abc")).toBeNull();
  });
  it("clamps percent to 100 and rounds amounts to cents", () => {
    expect(normalizeDiscount("percent", 150)).toEqual({ type: "percent", value: 100 });
    expect(normalizeDiscount("amount", "12.345")).toEqual({ type: "amount", value: 12.35 });
  });
});

describe("TAX_EXEMPT_REASONS", () => {
  it("offers the Workiz suggestions", () => {
    expect(TAX_EXEMPT_REASONS).toContain("Non-profit");
    expect(TAX_EXEMPT_REASONS).toContain("Other");
  });
});
