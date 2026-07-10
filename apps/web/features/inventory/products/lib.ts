import { ProductType, InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";

/* ------------------------------------------------------------------ *
 * Money & margins (plain decimal dollars)
 * ------------------------------------------------------------------ */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(n: number): string {
  return USD.format(Number.isFinite(n) ? n : 0);
}

/** Percent markup of price over a cost basis, or null when cost is 0/absent. */
export function marginPct(price: number, cost: number): number | null {
  if (!cost || cost <= 0) return null;
  return Math.round(((price - cost) / cost) * 100);
}

export function formatMargin(price: number, cost: number): string {
  const m = marginPct(price, cost);
  if (m === null) return "—";
  return `${m >= 0 ? "+" : ""}${m}%`;
}

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

export const TYPE_LABELS: Record<ProductType, string> = {
  [ProductType.PRODUCT]: "Product",
  [ProductType.SERVICE]: "Service",
};

export const STATUS_LABELS: Record<InventoryStatus, string> = {
  [InventoryStatus.ACTIVE]: "Active",
  [InventoryStatus.ARCHIVED]: "Archived",
};

export function typeLabel(t: ProductType): string {
  return TYPE_LABELS[t] ?? t;
}

export function statusLabel(s: InventoryStatus): string {
  return STATUS_LABELS[s] ?? s;
}

export function isService(p: Pick<Product, "type">): boolean {
  return p.type === ProductType.SERVICE;
}

/* ------------------------------------------------------------------ *
 * Categories (free-text, hierarchical) — typeahead source
 * ------------------------------------------------------------------ */

export function collectCategories(products: Pick<Product, "category">[]): string[] {
  const set = new Set<string>();
  for (const p of products) if (p.category) set.add(p.category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ *
 * Filtering — mirror the backend's mutually-exclusive precedence so the
 * UI only ever sends filters the server actually honors.
 *   category  ▸  type  ▸  (status + search)
 * ------------------------------------------------------------------ */

export interface ProductFilter {
  category?: string;
  type?: ProductType;
  status?: InventoryStatus;
  search?: string;
}

export function effectiveProductQuery(
  filter: ProductFilter,
): Record<string, string> {
  if (filter.category) return { category: filter.category };
  if (filter.type) return { type: filter.type };
  const out: Record<string, string> = {};
  if (filter.status) out.status = filter.status;
  if (filter.search) out.search = filter.search;
  return out;
}

/* ------------------------------------------------------------------ *
 * CSV import
 * ------------------------------------------------------------------ */

export const IMPORT_REQUIRED_COLUMNS = [
  "name",
  "sku",
  "category",
  "type",
  "costCompany",
  "costTech",
  "priceClient",
] as const;

export const IMPORT_OPTIONAL_COLUMNS = [
  "serialTracking",
  "minimumStockLevel",
  "supplier",
  "barcode",
  "description",
] as const;

/** Rough data-row count (excludes the header) for a friendly preview. */
export function countCsvRows(text: string): number {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length - 1;
}

const EXPORT_COLUMNS = [
  ...IMPORT_REQUIRED_COLUMNS,
  ...IMPORT_OPTIONAL_COLUMNS,
] as const;

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize products to a CSV that round-trips through the import endpoint. */
export function productsToCsv(products: Product[]): string {
  const header = EXPORT_COLUMNS.join(",");
  const rows = products.map((p) =>
    EXPORT_COLUMNS.map((c) => csvCell((p as unknown as Record<string, unknown>)[c])).join(","),
  );
  return [header, ...rows].join("\n");
}
