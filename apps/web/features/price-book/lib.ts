import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Brand, Product } from "@bitcrm/types";
import { isService } from "@/features/inventory/products/lib";
import type { ProductFilter } from "@/features/inventory/products/lib";

/* ------------------------------------------------------------------ *
 * The Items toolbar — what the reader picked, and what the server reads
 * ------------------------------------------------------------------ */

/** Workiz's "Manage stock" filter: every item, only the counted ones, or the rest. */
export type StockChoice = "all" | "tracked" | "untracked";

/**
 * The toolbar's state. `"all"` is a choice of its own in every select (Radix
 * has no empty value), so it lives here and never reaches the server.
 */
export interface PriceBookFilters {
  search: string;
  type: "all" | ProductType;
  /** A category **name** — items are filed under the name, not the id. */
  category: string;
  brandId: string;
  status: "all" | InventoryStatus;
  manageStock: StockChoice;
}

/** Active items of every type, stock-managed or not — the whole catalog. */
export const DEFAULT_FILTERS: PriceBookFilters = {
  search: "",
  type: "all",
  category: "all",
  brandId: "all",
  status: InventoryStatus.ACTIVE,
  manageStock: "all",
};

/**
 * The toolbar as query params: every choice at once, `All` left out. The
 * server combines them — nothing is filtered in the browser.
 */
export function toProductFilter(f: PriceBookFilters): ProductFilter {
  const out: ProductFilter = {};
  const search = f.search.trim();
  if (search) out.search = search;
  if (f.type !== "all") out.type = f.type;
  if (f.category !== "all") out.category = f.category;
  if (f.brandId !== "all") out.brandId = f.brandId;
  if (f.status !== "all") out.status = f.status;
  if (f.manageStock !== "all") out.manageStock = f.manageStock === "tracked";
  return out;
}

/** Anything narrower than the default view — the empty state then says "no match". */
export function isFiltered(f: PriceBookFilters): boolean {
  return (Object.keys(DEFAULT_FILTERS) as (keyof PriceBookFilters)[]).some((k) =>
    k === "search" ? f.search.trim() !== "" : f[k] !== DEFAULT_FILTERS[k],
  );
}

/* ------------------------------------------------------------------ *
 * Row labels
 * ------------------------------------------------------------------ */

/** Services are never stock-managed, whatever their flag says; absent ⇒ Yes for products. */
export function manageStockLabel(p: Pick<Product, "type" | "manageStock">): string {
  if (isService(p)) return "—";
  return p.manageStock === false ? "No" : "Yes";
}

/** Absent ⇒ taxable, as on the server. */
export function taxableLabel(p: Pick<Product, "taxable">): string {
  return p.taxable === false ? "No" : "Yes";
}

/** Brand id → name, archived brands included: an item still names its old brand. */
export function brandNameMap(brands: Brand[] | undefined): Map<string, string> {
  return new Map((brands ?? []).map((b) => [b.id, b.name]));
}
