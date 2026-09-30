import { describe, expect, it } from "vitest";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import {
  moneyText,
  newItemValues,
  toCreateBody,
  toUpdateBody,
  validateItem,
  valuesFromProduct,
} from "./item-form";

/** The Workiz item on the reference screenshots (Don-Jo chain guard). */
function chainGuard(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    number: 3551,
    sku: "1607-625 (SLK-3551)",
    name: "Don-Jo - Chain Guard - Silver (1607-625) (SLK-3551)",
    description: "SLK-3551\n UPC: 040186243617",
    category: "Door Hardware",
    type: ProductType.PRODUCT,
    costCompany: 20.16,
    costTech: 20.16,
    priceClient: 125,
    taxable: true,
    brandId: "b-slk",
    serialTracking: false,
    minimumStockLevel: 0,
    reorderLevel: 0,
    manageStock: true,
    supplier: "UHS",
    barcode: "040186243617",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    customAttributes: { Link_UHS: "https://uhs/1", workiz_attr_77: "orphan" },
    ...over,
  };
}

const names = ["ALL SKU", "In Store Location", "Link_UHS"];
const inventory = { variant: "inventory" as const, showCost: true, attributeNames: names };
const priceBook = { variant: "price-book" as const, showCost: true, attributeNames: names };

describe("valuesFromProduct", () => {
  it("shows money the Workiz way and keeps absent flags at their Workiz defaults", () => {
    const v = valuesFromProduct(chainGuard({ taxable: undefined, manageStock: undefined }));
    expect(v).toMatchObject({
      priceClient: "125.00",
      cost: "20.16",
      reorderLevel: "0",
      minimumStockLevel: "0",
      taxable: true,
      manageStock: true,
      active: true,
      priceBookEnabled: true,
      availableInBooking: false,
      bookingPrice: "",
    });
    expect(moneyText(undefined)).toBe("0.00");
  });

  it("an archived item reads as Enable item off", () => {
    expect(valuesFromProduct(chainGuard({ status: InventoryStatus.ARCHIVED })).active).toBe(false);
  });
});

describe("newItemValues", () => {
  it("Inventory adds a stocked product; Price Book a service, as Workiz opens them", () => {
    expect(newItemValues("inventory")).toMatchObject({ type: ProductType.PRODUCT, manageStock: true, priceClient: "0.00", cost: "0.00", taxable: true });
    expect(newItemValues("price-book")).toMatchObject({ type: ProductType.SERVICE, manageStock: false, taxable: true });
  });
});

describe("validateItem", () => {
  it("a new item needs a name and a SKU", () => {
    expect(validateItem(newItemValues("inventory"), { mode: "create", showCost: true, variant: "inventory" })).toEqual({
      name: "Required",
      sku: "Required",
    });
  });

  it("an imported value over a cap is accepted until the user changes it", () => {
    const long = chainGuard({ name: "N".repeat(262), description: "D".repeat(1500) });
    const original = valuesFromProduct(long);
    expect(validateItem(original, { mode: "edit", original, showCost: true, variant: "inventory" })).toEqual({});
    expect(
      validateItem({ ...original, name: "M".repeat(200) }, { mode: "edit", original, showCost: true, variant: "inventory" }),
    ).toEqual({ name: "Must be 120 characters or fewer" });
  });

  it("checks amounts and whole counts", () => {
    const original = valuesFromProduct(chainGuard());
    const errors = validateItem(
      { ...original, priceClient: "abc", cost: "-1", reorderLevel: "1.5", minimumStockLevel: "-2" },
      { mode: "edit", original, showCost: true, variant: "inventory" },
    );
    expect(errors).toEqual({
      priceClient: "Enter an amount",
      cost: "Must be 0 or more",
      reorderLevel: "Whole number",
      minimumStockLevel: "Must be 0 or more",
    });
  });

  it("Booking Price is required only while Add to booking items is on (Price Book)", () => {
    const original = valuesFromProduct(chainGuard());
    const on = { ...original, availableInBooking: true, bookingPrice: "" };
    expect(validateItem(on, { mode: "edit", original, showCost: true, variant: "price-book" })).toEqual({ bookingPrice: "Required" });
  });
});

describe("toUpdateBody", () => {
  it("sends nothing for an untouched item — hidden fields (barcode, supplier, tech cost) never go", () => {
    const p = chainGuard();
    expect(toUpdateBody(p, valuesFromProduct(p), inventory)).toEqual({});
  });

  it("sends only what changed; Cost is the company cost; emptied optional fields clear", () => {
    const p = chainGuard();
    const v = {
      ...valuesFromProduct(p),
      name: "  Chain Guard  ",
      cost: "21.00",
      brandId: "",
      description: "",
      reorderLevel: "",
      minimumStockLevel: "3",
      taxable: false,
    };
    expect(toUpdateBody(p, v, inventory)).toEqual({
      name: "Chain Guard",
      costCompany: 21,
      brandId: null,
      description: null,
      reorderLevel: null,
      minimumStockLevel: 3,
      taxable: false,
    });
  });

  it("never sends the cost without financials.view", () => {
    const p = chainGuard();
    const v = { ...valuesFromProduct(p), cost: "99.00" };
    expect(toUpdateBody(p, v, { ...inventory, showCost: false })).toEqual({});
  });

  it("sends a changed SKU trimmed (Workiz lets it be edited); the same one is no change", () => {
    const p = chainGuard();
    expect(toUpdateBody(p, { ...valuesFromProduct(p), sku: "  SLK-3551 " }, inventory)).toEqual({ sku: "SLK-3551" });
    expect(toUpdateBody(p, { ...valuesFromProduct(p), sku: `${p.sku} ` }, inventory)).toEqual({});
  });

  it("an emptied SKU is refused", () => {
    const original = valuesFromProduct(chainGuard());
    expect(validateItem({ ...original, sku: " " }, { mode: "edit", original, showCost: true, variant: "inventory" })).toEqual({
      sku: "Required",
    });
  });

  it("custom fields go as a patch of the changed names only (orphans untouched)", () => {
    const p = chainGuard();
    const v = {
      ...valuesFromProduct(p),
      customAttributes: { ...p.customAttributes!, Link_UHS: "", "ALL SKU": "A-1" },
    };
    expect(toUpdateBody(p, v, inventory)).toEqual({
      customAttributes: { Link_UHS: null, "ALL SKU": "A-1" },
    });
  });

  it("Price Book sends its own switches; Inventory never sends them", () => {
    const p = chainGuard({ manageStock: false });
    const v = {
      ...valuesFromProduct(p),
      type: ProductType.PRODUCT,
      manageStock: true,
      priceBookEnabled: false,
      availableInBooking: true,
      bookingPrice: "40",
    };
    expect(toUpdateBody(p, v, priceBook)).toEqual({
      manageStock: true,
      priceBookEnabled: false,
      availableInBooking: true,
      bookingPrice: 40,
    });
    expect(toUpdateBody(p, v, inventory)).toEqual({});
  });
});

describe("toCreateBody", () => {
  it("fills what the Workiz popup has no field for the way the importer does", () => {
    const v = {
      ...newItemValues("inventory"),
      name: "Deadbolt",
      sku: "DB-1",
      cost: "10.50",
      priceClient: "45",
      reorderLevel: "2",
      customAttributes: { "ALL SKU": "X", Link_UHS: " ", Unknown: "dropped" },
    };
    expect(toCreateBody(v, inventory)).toEqual({
      name: "Deadbolt",
      sku: "DB-1",
      category: "Uncategorized",
      type: ProductType.PRODUCT,
      description: undefined,
      brandId: undefined,
      priceClient: 45,
      costCompany: 10.5,
      costTech: 10.5,
      taxable: true,
      serialTracking: false,
      manageStock: true,
      minimumStockLevel: 0,
      reorderLevel: 2,
      customAttributes: { "ALL SKU": "X" },
    });
  });

  it("a Price Book service is never stock-managed and carries the booking switch", () => {
    const body = toCreateBody(
      { ...newItemValues("price-book"), name: "Rekey", sku: "RK", availableInBooking: true, bookingPrice: "30" },
      priceBook,
    );
    expect(body).toMatchObject({ type: ProductType.SERVICE, manageStock: false, availableInBooking: true, bookingPrice: 30 });
  });

  it("without financials.view both costs are 0", () => {
    const body = toCreateBody({ ...newItemValues("inventory"), name: "A", sku: "B", cost: "9" }, { ...inventory, showCost: false });
    expect(body).toMatchObject({ costCompany: 0, costTech: 0 });
  });
});
