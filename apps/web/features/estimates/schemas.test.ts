import { describe, expect, it } from "vitest";
import { estimateHeaderSchema, estimateItemSchema, newEstimateSchema } from "./schemas";

describe("newEstimateSchema", () => {
  it("defaults to copying nothing and trims the name", () => {
    expect(newEstimateSchema.parse({ name: "  Good  " })).toEqual({ name: "Good", copyJobItems: false });
  });
  it("caps the name", () => {
    expect(newEstimateSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });
});

describe("estimateItemSchema", () => {
  const base = {
    productId: "p1", name: "Lock", sku: "L-1", quantity: "2", priceClient: "10.5",
    costCompany: 4, costForTech: 5, taxable: true,
  };
  it("coerces numeric inputs", () => {
    const r = estimateItemSchema.parse(base);
    expect(r.quantity).toBe(2);
    expect(r.priceClient).toBe(10.5);
  });
  it("rejects zero quantity and negative price", () => {
    expect(estimateItemSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(estimateItemSchema.safeParse({ ...base, priceClient: -1 }).success).toBe(false);
  });
  it("drops an empty description", () => {
    expect(estimateItemSchema.parse({ ...base, description: "   " }).description).toBeUndefined();
  });
});

describe("estimateHeaderSchema", () => {
  it("validates the date", () => {
    expect(estimateHeaderSchema.safeParse({ name: "", estimateDate: "2026-09-16", notes: "" }).success).toBe(true);
    expect(estimateHeaderSchema.safeParse({ name: "", estimateDate: "nope", notes: "" }).success).toBe(false);
  });
});
