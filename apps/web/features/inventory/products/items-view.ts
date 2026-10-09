import { InventoryStatus } from "@bitcrm/types";
import type { ItemAttribute } from "@bitcrm/types";
import type { ProductFilter, ProductStockLevel } from "./lib";

/**
 * The boxes over Workiz's Inventory grid (pg_inventory_wz_01_inventory) —
 * All brands, All categories, All Stock Levels — and BitCRM's own status box
 * beside them (Workiz deletes items; BitCRM disables them, so the way back
 * stays). `"all"` is a box's All.
 */
export interface ItemsFilters {
  brand: string;
  category: string;
  stock: ProductStockLevel | "all";
  status: InventoryStatus | "all";
}

export const ITEMS_FILTERS_DEFAULT: ItemsFilters = {
  brand: "all",
  category: "all",
  stock: "all",
  status: InventoryStatus.ACTIVE,
};

/** What the server is asked for: the stock-managed items under every box that is not on All. */
export function itemsFilter(f: ItemsFilters, search: string): ProductFilter {
  const term = search.trim();
  return {
    manageStock: true,
    ...(f.brand !== "all" && { brandId: f.brand }),
    ...(f.category !== "all" && { category: f.category }),
    ...(f.stock !== "all" && { stockLevel: f.stock }),
    ...(f.status !== "all" && { status: f.status }),
    ...(term && { search: term }),
  };
}

/** Workiz's grid amounts and quantities: "125.00", "374.00" — two decimals, no "$", no grouping. */
export function wzAmount(n: number | null | undefined): string {
  return (typeof n === "number" && Number.isFinite(n) ? n : 0).toFixed(2);
}

/**
 * The item custom fields Workiz lists as grid columns after Brand, in the
 * catalog's order. The import's orphans (`workiz_attr_<id>`, a field Workiz
 * no longer names) are not columns.
 */
export function customFieldColumns(attributes: readonly ItemAttribute[] | undefined): string[] {
  return (attributes ?? [])
    .filter((a) => (a as ItemAttribute & { orphan?: boolean }).orphan !== true)
    .map((a) => a.name);
}
