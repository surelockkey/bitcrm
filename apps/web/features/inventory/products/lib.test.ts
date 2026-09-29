import { describe, it, expect } from "vitest";
import { ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import {
  formatMoney,
  marginPct,
  formatMargin,
  isService,
  productsToCsv,
} from "./lib";

describe("money + margin", () => {
  it("formats USD", () => {
    expect(formatMoney(45)).toBe("$45.00");
    expect(formatMoney(0)).toBe("$0.00");
  });
  it("computes margin percent over cost", () => {
    expect(marginPct(45, 15)).toBe(200);
    expect(marginPct(45, 18)).toBe(150);
  });
  it("returns null margin when cost is zero", () => {
    expect(marginPct(45, 0)).toBeNull();
    expect(formatMargin(45, 0)).toBe("—");
  });
  it("formats margin with a sign", () => {
    expect(formatMargin(45, 15)).toBe("+200%");
  });
});

describe("type", () => {
  it("detects services", () => {
    expect(isService({ type: ProductType.SERVICE } as Product)).toBe(true);
    expect(isService({ type: ProductType.PRODUCT } as Product)).toBe(false);
  });
});

describe("productsToCsv", () => {
  const deadbolt = {
    id: "p1",
    sku: "LOCK-001",
    name: "Deadbolt",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 10,
    costTech: 18,
    priceClient: 45,
    serialTracking: false,
    minimumStockLevel: 5,
  } as Product;

  it("writes the columns the import reads back, company cost included", () => {
    const [header, row] = productsToCsv([deadbolt]).split("\n");
    expect(header.split(",")).toContain("costCompany");
    expect(row).toContain("10");
  });

  // Company cost is money (financials.view). The column is dropped rather than
  // blanked: a file without it fails the import's required-column check,
  // where a blank one would read back as a cost of 0.
  it("drops the company-cost column entirely when asked to", () => {
    const [header, row] = productsToCsv([deadbolt], { withCost: false }).split("\n");
    expect(header.split(",")).not.toContain("costCompany");
    expect(row.split(",")).toHaveLength(header.split(",").length);
    expect(row.split(",")).not.toContain("10");
  });
});
