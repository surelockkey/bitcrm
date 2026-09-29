import { describe, it, expect } from "vitest";
import { ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import {
  formatMoney,
  marginPct,
  formatMargin,
  collectCategories,
  isService,
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

describe("categories + type", () => {
  const products = [
    { category: "Locks > Residential", type: ProductType.PRODUCT },
    { category: "Keys", type: ProductType.PRODUCT },
    { category: "Locks > Residential", type: ProductType.PRODUCT },
  ] as Product[];

  it("collects unique, sorted categories", () => {
    expect(collectCategories(products)).toEqual(["Keys", "Locks > Residential"]);
  });
  it("detects services", () => {
    expect(isService({ type: ProductType.SERVICE } as Product)).toBe(true);
    expect(isService({ type: ProductType.PRODUCT } as Product)).toBe(false);
  });
});
