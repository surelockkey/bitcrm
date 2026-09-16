import { describe, it, expect } from "vitest";
import { ProductType } from "@bitcrm/types";
import {
  createProductSchema,
  updateProductSchema,
  updateProductSchemaFor,
} from "./schemas";

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

describe("updateProductSchemaFor (imported items)", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sku: _sku, ...editable } = base;
  const longName = "L".repeat(262);
  const longDescription = "D".repeat(1400);

  it("behaves exactly like updateProductSchema with no original", () => {
    const schema = updateProductSchemaFor();
    expect(schema.safeParse(editable).success).toBe(true);
    expect(schema.safeParse({ ...editable, name: longName }).success).toBe(false);
    expect(schema.safeParse({ ...editable, priceClient: -35 }).success).toBe(false);
  });

  it("lets an imported item keep a name over the 120-char cap", () => {
    const schema = updateProductSchemaFor({ ...editable, name: longName });
    expect(schema.safeParse({ ...editable, name: longName }).success).toBe(true);
  });

  it("lets an imported item keep a negative price while another field is fixed", () => {
    const schema = updateProductSchemaFor({ ...editable, priceClient: -35 });
    const parsed = schema.safeParse({
      ...editable,
      priceClient: -35,
      category: "Uncategorized",
    });
    expect(parsed.success).toBe(true);
  });

  it("lets an imported item keep a description over the 1000-char cap", () => {
    const schema = updateProductSchemaFor({ ...editable, description: longDescription });
    expect(
      schema.safeParse({ ...editable, description: longDescription }).success,
    ).toBe(true);
  });

  it("waives the cap only for the stored value — a new over-long one is rejected", () => {
    const schema = updateProductSchemaFor({ ...editable, name: longName });
    const parsed = schema.safeParse({ ...editable, name: `${longName}X` });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(["name"]);
      expect(parsed.error.issues[0].message).toBe("Must be 120 characters or fewer");
    }
  });

  it("waives the floor only for the stored price — a new negative one is rejected", () => {
    const schema = updateProductSchemaFor({ ...editable, priceClient: -35 });
    const parsed = schema.safeParse({ ...editable, priceClient: -36 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["priceClient"]);
  });

  it("compares the stored value trimmed — 3 116 imported names have edge spaces", () => {
    const padded = `  ${longName}  `;
    const schema = updateProductSchemaFor({ ...editable, name: padded });
    expect(schema.safeParse({ ...editable, name: padded }).success).toBe(true);
  });

  it("still enforces the rules that are not caps (required, whole numbers)", () => {
    const schema = updateProductSchemaFor({ ...editable, name: longName });
    expect(schema.safeParse({ ...editable, name: "" }).success).toBe(false);
    expect(schema.safeParse({ ...editable, category: "" }).success).toBe(false);
    expect(schema.safeParse({ ...editable, minimumStockLevel: 1.5 }).success).toBe(false);
  });

  it("accepts a price of exactly 0 — the price book is full of them", () => {
    const schema = updateProductSchemaFor();
    expect(schema.safeParse({ ...editable, priceClient: 0 }).success).toBe(true);
  });
});
