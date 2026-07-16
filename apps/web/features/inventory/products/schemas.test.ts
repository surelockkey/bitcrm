import { describe, it, expect } from "vitest";
import { ProductType } from "@bitcrm/types";
import { createProductSchema, updateProductSchema } from "./schemas";

const base = {
  name: "Deadbolt",
  sku: "LOCK-001",
  category: "Locks",
  type: ProductType.PRODUCT,
  costCompany: 10,
  costTech: 15,
  priceClient: 25,
  serialTracking: false,
  minimumStockLevel: 5,
};

describe("createProductSchema", () => {
  it("accepts a valid product", () => {
    expect(createProductSchema.safeParse(base).success).toBe(true);
  });
  it("requires a SKU", () => {
    expect(createProductSchema.safeParse({ ...base, sku: "" }).success).toBe(false);
  });
  it("requires a name and category", () => {
    expect(createProductSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, category: "" }).success).toBe(false);
  });
  it("rejects negative money", () => {
    expect(createProductSchema.safeParse({ ...base, priceClient: -1 }).success).toBe(false);
  });
  it("coerces numeric strings from form inputs", () => {
    const parsed = createProductSchema.safeParse({ ...base, priceClient: "25", minimumStockLevel: "5" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.priceClient).toBe(25);
  });
});

describe("updateProductSchema", () => {
  it("does not include SKU (immutable)", () => {
    const parsed = updateProductSchema.parse({ ...base, sku: "IGNORED" });
    expect("sku" in parsed).toBe(false);
  });
});
