import type { EnrichedStockRow } from "@/features/inventory/warehouses/lib";
import type { LocationStockRowIn } from "@/features/inventory/stock/api";
import { stockRowsOf } from "@/features/inventory/stock/lib";
import { sortStockRows } from "./lib";

/** A van's row on `/my-stock`: the inventory's own row plus its cost. */
export interface MyStockRow extends EnrichedStockRow {
  /** What one costs the company — shown only to a viewer with `financials.view`. */
  cost?: number;
}

/**
 * The van's stock as the grid lists it: named and priced the way every
 * inventory view reads a location (`stockRowsOf`), with the company cost the
 * row carries, and low stock first — the only rows that need doing something
 * about — then by name.
 */
export function myStockRows(rows: readonly LocationStockRowIn[]): MyStockRow[] {
  const cost = new Map(rows.map((r) => [r.productId, r.costCompany]));
  return sortStockRows(stockRowsOf([...rows]).map((r) => ({ ...r, cost: cost.get(r.productId) })));
}

export interface MyStockTotals {
  /** Workiz's "Total Items On Hand". */
  onHand: number;
  /** Rows on the van. */
  items: number;
  /** Rows at or under their minimum. */
  low: number;
  /** Workiz's "Total Items cost": Σ cost × quantity. */
  cost: number;
  /** Workiz's "Sale Items Value": Σ price × quantity. */
  sale: number;
}

/** The figures at the right of Workiz's "Manage stock: <location>" sheet (pg_inventory_wz_13). */
export function myStockTotals(rows: readonly MyStockRow[]): MyStockTotals {
  return rows.reduce<MyStockTotals>(
    (t, r) => ({
      onHand: t.onHand + r.quantity,
      items: t.items + 1,
      low: t.low + (r.isLow ? 1 : 0),
      cost: t.cost + (r.cost ?? 0) * r.quantity,
      sale: t.sale + (r.unitPrice ?? 0) * r.quantity,
    }),
    { onHand: 0, items: 0, low: 0, cost: 0, sale: 0 },
  );
}

/**
 * A figure as Workiz's sheet prints it — "125", "20.16", "36996.365": plain,
 * no thousands separator, no padded decimals (rounded to three places so a
 * float sum never reads 0.30000000000000004). Nothing for a missing one.
 */
export function stockFigure(n: number | undefined | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

const csvCell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Export: the grid's columns for every row on the van; Price and Cost only with `money`. */
export function myStockCsv(rows: readonly MyStockRow[], { money }: { money: boolean }): string {
  const head = ["Product Name", "SKU", "Category", "Quantity", ...(money ? ["Price", "Cost"] : [])];
  const lines = rows.map((r) =>
    [
      r.name,
      r.sku ?? "",
      r.category ?? "",
      stockFigure(r.quantity),
      ...(money ? [stockFigure(r.unitPrice), stockFigure(r.cost)] : []),
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n");
}
