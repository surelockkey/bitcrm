import { InventoryStatus, ProductType, UNCATEGORIZED_CATEGORY } from "@bitcrm/types";
import type { Product, ProductWithExtras } from "@bitcrm/types";
import type { CreateProductValues, PatchProductValues, ProductExtrasBody } from "@/features/inventory/products/schemas";
import { customAttributesPatch } from "@/features/inventory/item-attributes/lib";

/**
 * Which Workiz popup: Inventory's "Edit Inventory item" or Price Book's
 * "Edit Item". Same item, different fields and words.
 */
export type ItemVariant = "inventory" | "price-book";

/** Everything the popup edits, as the inputs hold it (text for numbers). */
export interface ItemFormValues {
  name: string;
  /** Inventory "SKU", Price Book "Model #" — both are Workiz `serial`. */
  sku: string;
  brandId: string;
  category: string;
  type: ProductType;
  description: string;
  reorderLevel: string;
  minimumStockLevel: string;
  priceClient: string;
  /** Workiz "Cost" / "Unit Cost" — BitCRM's company cost. */
  cost: string;
  taxable: boolean;
  manageStock: boolean;
  /** "Enable item" — the item's status (archived = disabled). */
  active: boolean;
  priceBookEnabled: boolean;
  availableInBooking: boolean;
  bookingPrice: string;
  customAttributes: Record<string, string>;
}

export type ItemFormErrors = Partial<Record<keyof ItemFormValues, string>>;

/** Workiz shows money with two decimals ("125.00"). */
export function moneyText(n: number | undefined | null): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function countText(n: number | undefined | null): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "";
}

/**
 * The SKU / Model # as Workiz shows it. An item saved without one carries an
 * internal SKU (`skuGenerated`) — shown empty. The importer's `WZ-<id>`
 * stands in for a Workiz serial that was empty, duplicated or too long; the
 * serial itself (if any) is in `workizSerial`, and that is what Workiz shows.
 */
export function displaySku(p: Pick<Product, "sku" | "skuGenerated">): string {
  if (p.skuGenerated) return "";
  const serial = (p as ProductWithExtras).workizSerial as string | null | undefined;
  if (p.sku?.startsWith("WZ-") && serial !== p.sku) return serial ?? "";
  return p.sku ?? "";
}

/** No category, as Workiz shows it: BitCRM's "Uncategorized" is an empty field. */
export function displayCategory(category: string | undefined): string {
  return !category || category.trim().toLowerCase() === UNCATEGORIZED_CATEGORY.toLowerCase()
    ? ""
    : category;
}

export function valuesFromProduct(p: Product): ItemFormValues {
  return {
    name: p.name ?? "",
    sku: displaySku(p),
    brandId: p.brandId ?? "",
    category: displayCategory(p.category),
    type: p.type ?? ProductType.PRODUCT,
    description: p.description ?? "",
    reorderLevel: countText(p.reorderLevel),
    minimumStockLevel: countText(p.minimumStockLevel),
    priceClient: moneyText(p.priceClient),
    cost: moneyText(p.costCompany),
    taxable: p.taxable !== false,
    manageStock: p.manageStock !== false,
    active: p.status !== InventoryStatus.ARCHIVED,
    priceBookEnabled: p.priceBookEnabled !== false,
    availableInBooking: p.availableInBooking === true,
    bookingPrice: typeof p.bookingPrice === "number" ? moneyText(p.bookingPrice) : "",
    customAttributes: { ...(p.customAttributes ?? {}) },
  };
}

/**
 * A new item, as Workiz opens "Add Inventory item" (a stocked product) and
 * "Add New Item" (a service, stock not managed): prices 0.00, taxable on.
 */
export function newItemValues(variant: ItemVariant): ItemFormValues {
  const inventory = variant === "inventory";
  return {
    name: "",
    sku: "",
    brandId: "",
    category: "",
    type: inventory ? ProductType.PRODUCT : ProductType.SERVICE,
    description: "",
    reorderLevel: "",
    minimumStockLevel: "",
    priceClient: "0.00",
    cost: "0.00",
    taxable: true,
    manageStock: inventory,
    active: true,
    priceBookEnabled: true,
    availableInBooking: false,
    bookingPrice: "",
    customAttributes: {},
  };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/**
 * The caps a new item must meet. An imported item can break them (262 Workiz
 * names are over 120 characters, 61 prices are negative); an edit enforces a
 * cap only on a field the user changed, so such an item still saves.
 */
const CAPS = { name: 120, sku: 64, description: 1000 } as const;

function parseMoney(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

function parseCount(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export interface ValidateOptions {
  mode: "create" | "edit";
  /** The stored item (edit): a field left as it was is not held to the caps. */
  original?: ItemFormValues;
  /** The caller sees the company cost (`financials.view`). */
  showCost: boolean;
  variant: ItemVariant;
}

export function validateItem(v: ItemFormValues, o: ValidateOptions): ItemFormErrors {
  const errors: ItemFormErrors = {};
  const changed = (k: keyof ItemFormValues) => !o.original || o.original[k] !== v[k];

  if (!v.name.trim()) errors.name = "Required";
  else if (changed("name") && v.name.trim().length > CAPS.name) {
    errors.name = `Must be ${CAPS.name} characters or fewer`;
  }

  // Optional, as in Workiz: left empty, the item keeps (or gets) an internal SKU.
  if (changed("sku") && v.sku.trim().length > CAPS.sku) {
    errors.sku = `Must be ${CAPS.sku} characters or fewer`;
  }

  if (changed("description") && v.description.trim().length > CAPS.description) {
    errors.description = `Must be ${CAPS.description} characters or fewer`;
  }

  const money = (k: "priceClient" | "cost" | "bookingPrice", required: boolean, always = false) => {
    if (!always && !changed(k)) return;
    const n = parseMoney(v[k]);
    if (n === null) {
      if (required) errors[k] = "Required";
    } else if (Number.isNaN(n)) errors[k] = "Enter an amount";
    else if (n < 0) errors[k] = "Must be 0 or more";
  };
  money("priceClient", true);
  if (o.showCost) money("cost", false);
  // Checked whenever the switch is on — switching it on is what makes it required.
  if (o.variant === "price-book" && v.availableInBooking) money("bookingPrice", true, true);

  const count = (k: "reorderLevel" | "minimumStockLevel") => {
    if (!changed(k)) return;
    const n = parseCount(v[k]);
    if (n === null) return;
    if (Number.isNaN(n) || !Number.isInteger(n)) errors[k] = "Whole number";
    else if (n < 0) errors[k] = "Must be 0 or more";
  };
  if (o.variant === "inventory") {
    count("reorderLevel");
    count("minimumStockLevel");
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * Request bodies
 * ------------------------------------------------------------------ */

export interface BodyOptions {
  variant: ItemVariant;
  showCost: boolean;
  /** The custom field names the catalog knows — only those are sent. */
  attributeNames: string[];
}

/**
 * The PUT body for an edit: only what the user changed, so an imported item
 * with an out-of-range value elsewhere still saves (the API validates only the
 * fields sent). An emptied optional field is `null`, which clears it. A new
 * SKU moves the item to it (a SKU another item has is refused by the API).
 * "Enable item" is not in the body: it archives or restores the item through
 * its own routes.
 */
export function toUpdateBody(
  product: Product,
  v: ItemFormValues,
  o: BodyOptions,
): PatchProductValues {
  const before = valuesFromProduct(product);
  const body: PatchProductValues = {};
  const changed = (k: keyof ItemFormValues) => before[k] !== v[k];

  if (changed("name")) body.name = v.name.trim();
  // Measured against what the field showed, so an untouched field never sends
  // the importer's WZ- SKU or an internal one. Emptied, it goes as "" — the
  // item then keeps (or gets) an internal SKU.
  if (v.sku.trim() !== before.sku.trim()) body.sku = v.sku.trim();
  if (changed("brandId")) body.brandId = v.brandId || null;
  if (changed("category")) body.category = v.category || UNCATEGORIZED_CATEGORY;
  if (changed("description")) body.description = v.description.trim() === "" ? null : v.description;
  if (changed("priceClient")) body.priceClient = parseMoney(v.priceClient) ?? 0;
  if (o.showCost && changed("cost")) body.costCompany = parseMoney(v.cost) ?? 0;
  if (changed("taxable")) body.taxable = v.taxable;

  if (o.variant === "inventory") {
    if (changed("reorderLevel")) body.reorderLevel = parseCount(v.reorderLevel);
    if (changed("minimumStockLevel")) body.minimumStockLevel = parseCount(v.minimumStockLevel) ?? 0;
  } else {
    if (changed("type")) body.type = v.type;
    if (v.type === ProductType.PRODUCT && changed("manageStock")) body.manageStock = v.manageStock;
    if (changed("priceBookEnabled")) body.priceBookEnabled = v.priceBookEnabled;
    if (changed("availableInBooking")) body.availableInBooking = v.availableInBooking;
    if (v.availableInBooking && changed("bookingPrice")) {
      body.bookingPrice = parseMoney(v.bookingPrice);
    }
  }

  const patch = customAttributesPatch(product.customAttributes, v.customAttributes, o.attributeNames);
  if (patch) body.customAttributes = patch;
  return body;
}

/** A new item's POST body: the SKU may be left out — the API then makes an internal one. */
export type CreateItemBody = Omit<CreateProductValues, "sku"> & { sku?: string } & ProductExtrasBody;

/**
 * The POST body for a new item. The fields the Workiz popup has no place for
 * get what an import gives them: tech cost = cost, no serial tracking, and
 * "Uncategorized" when no category was chosen (BitCRM files every item under
 * one). An empty SKU / Model # is left out, as Workiz allows.
 */
export function toCreateBody(v: ItemFormValues, o: BodyOptions): CreateItemBody {
  const cost = o.showCost ? (parseMoney(v.cost) ?? 0) : 0;
  const inventory = o.variant === "inventory";
  const type = inventory ? ProductType.PRODUCT : v.type;
  const values: Record<string, string> = {};
  for (const name of o.attributeNames) {
    const value = v.customAttributes[name];
    if (value && value.trim()) values[name] = value;
  }
  return {
    name: v.name.trim(),
    ...(v.sku.trim() ? { sku: v.sku.trim() } : {}),
    category: v.category || UNCATEGORIZED_CATEGORY,
    type,
    description: v.description.trim() ? v.description : undefined,
    brandId: v.brandId || undefined,
    priceClient: parseMoney(v.priceClient) ?? 0,
    costCompany: cost,
    costTech: cost,
    taxable: v.taxable,
    serialTracking: false,
    // A service is never stock-managed; a Price Book product only when asked.
    manageStock: type === ProductType.PRODUCT ? (inventory ? true : v.manageStock) : false,
    minimumStockLevel: inventory ? (parseCount(v.minimumStockLevel) ?? 0) : 0,
    reorderLevel: inventory ? (parseCount(v.reorderLevel) ?? undefined) : undefined,
    ...(inventory
      ? {}
      : {
          availableInBooking: v.availableInBooking,
          ...(v.availableInBooking ? { bookingPrice: parseMoney(v.bookingPrice) ?? 0 } : {}),
        }),
    ...(Object.keys(values).length ? { customAttributes: values } : {}),
  };
}
