import { describe, it, expect } from "vitest";
import { warehouseSchema } from "./schemas";

describe("warehouseSchema", () => {
  it("accepts a name-only warehouse", () => {
    expect(warehouseSchema.safeParse({ name: "Central" }).success).toBe(true);
  });
  it("requires a name", () => {
    expect(warehouseSchema.safeParse({ name: "" }).success).toBe(false);
    expect(warehouseSchema.safeParse({ name: "   " }).success).toBe(false);
  });
  it("accepts optional address and description", () => {
    const r = warehouseSchema.safeParse({
      name: "Central",
      address: "1 Main St",
      description: "Bulk shelf",
    });
    expect(r.success).toBe(true);
  });
});
