import { describe, it, expect } from "vitest";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Brand, Product } from "@bitcrm/types";
import {
  DEFAULT_FILTERS,
  brandNameMap,
  isFiltered,
  manageStockLabel,
  taxableLabel,
  toProductFilter,
} from "./lib";

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    sku: "S",
    name: "N",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 1,
    costTech: 1,
    priceClient: 1,
    serialTracking: false,
    minimumStockLevel: 0,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("toProductFilter — the toolbar as the server reads it", () => {
  it("starts on active items of every type, stock-managed or not", () => {
    expect(toProductFilter(DEFAULT_FILTERS)).toEqual({ status: InventoryStatus.ACTIVE });
  });

  it("sends every choice at once — the server combines them", () => {
    expect(
      toProductFilter({
        search: "  dead  ",
        type: ProductType.SERVICE,
        category: "Locks",
        brandId: "b1",
        status: InventoryStatus.ARCHIVED,
        manageStock: "untracked",
      }),
    ).toEqual({
      search: "dead",
      type: ProductType.SERVICE,
      category: "Locks",
      brandId: "b1",
      status: InventoryStatus.ARCHIVED,
      manageStock: false,
    });
  });

  it("drops each All, and a blank search", () => {
    expect(
      toProductFilter({
        search: "   ",
        type: "all",
        category: "all",
        brandId: "all",
        status: "all",
        manageStock: "all",
      }),
    ).toEqual({});
  });

  it("reads Tracked as manageStock=true", () => {
    expect(toProductFilter({ ...DEFAULT_FILTERS, manageStock: "tracked" }).manageStock).toBe(true);
  });
});

describe("isFiltered", () => {
  it("is false for the default view and true once anything narrows it", () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, search: "x" })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, type: ProductType.PRODUCT })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, status: "all" })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, manageStock: "tracked" })).toBe(true);
  });
});

describe("row labels", () => {
  it("says a service is never stock-managed — a dash, whatever its flag", () => {
    expect(manageStockLabel(product({ type: ProductType.SERVICE, manageStock: true }))).toBe("—");
  });

  it("reads an absent manageStock on a product as Yes", () => {
    expect(manageStockLabel(product())).toBe("Yes");
    expect(manageStockLabel(product({ manageStock: false }))).toBe("No");
  });

  it("reads an absent taxable as Yes", () => {
    expect(taxableLabel(product())).toBe("Yes");
    expect(taxableLabel(product({ taxable: false }))).toBe("No");
  });

  it("maps brand ids to names, archived brands included", () => {
    const brands: Brand[] = [
      { id: "b1", name: "Schlage", active: true, createdBy: "", createdAt: "", updatedAt: "" },
      { id: "b2", name: "Old", active: false, createdBy: "", createdAt: "", updatedAt: "" },
    ];
    const names = brandNameMap(brands);
    expect(names.get("b1")).toBe("Schlage");
    expect(names.get("b2")).toBe("Old");
    expect(brandNameMap(undefined).size).toBe(0);
  });
});
