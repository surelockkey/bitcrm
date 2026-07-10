import { describe, it, expect } from "vitest";
import { ProductType, InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import {
  formatMoney,
  marginPct,
  formatMargin,
  collectCategories,
  effectiveProductQuery,
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

describe("effectiveProductQuery — mirrors backend filter precedence", () => {
  it("category wins over everything", () => {
    expect(
      effectiveProductQuery({ category: "Locks", type: ProductType.PRODUCT, status: InventoryStatus.ACTIVE, search: "x" }),
    ).toEqual({ category: "Locks" });
  });
  it("type wins when no category", () => {
    expect(
      effectiveProductQuery({ type: ProductType.SERVICE, status: InventoryStatus.ACTIVE, search: "x" }),
    ).toEqual({ type: ProductType.SERVICE });
  });
  it("search + status combine when no category/type", () => {
    expect(
      effectiveProductQuery({ status: InventoryStatus.ARCHIVED, search: "lock" }),
    ).toEqual({ status: InventoryStatus.ARCHIVED, search: "lock" });
  });
  it("empty filter yields empty query", () => {
    expect(effectiveProductQuery({})).toEqual({});
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
