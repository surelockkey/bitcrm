import { LocationType, TransferType } from "@bitcrm/types";
import type { Product, StockItem, Transfer, Container } from "@bitcrm/types";

export { formatMoney } from "@/features/inventory/products/lib";

/* ------------------------------------------------------------------ *
 * Catalog join — turn bare stock rows into an inventory view.
 * Stock rows only carry productId/productName/quantity; SKU, category,
 * price, value and low-stock come from the product catalog.
 * ------------------------------------------------------------------ */

export interface EnrichedStockRow {
  productId: string;
  name: string;
  sku?: string;
  category?: string;
  quantity: number;
  unitPrice?: number;
  value?: number;
  minLevel?: number;
  isLow: boolean;
}

export function enrichStock(
  stock: StockItem[],
  products: Map<string, Product>,
): EnrichedStockRow[] {
  return stock.map((s) => {
    const p = products.get(s.productId);
    const unitPrice = p?.priceClient;
    const minLevel = p?.minimumStockLevel;
    return {
      productId: s.productId,
      name: p?.name ?? s.productName,
      sku: p?.sku,
      category: p?.category,
      quantity: s.quantity,
      unitPrice,
      value: unitPrice != null ? unitPrice * s.quantity : undefined,
      minLevel,
      isLow: minLevel != null && minLevel > 0 && s.quantity <= minLevel,
    };
  });
}

export interface StockSummary {
  skuCount: number;
  totalUnits: number;
  totalValue: number;
  lowCount: number;
}

export function summarizeStock(rows: EnrichedStockRow[]): StockSummary {
  return {
    skuCount: rows.length,
    totalUnits: rows.reduce((n, r) => n + r.quantity, 0),
    totalValue: rows.reduce((n, r) => n + (r.value ?? 0), 0),
    lowCount: rows.filter((r) => r.isLow).length,
  };
}

/* ------------------------------------------------------------------ *
 * Transfers
 * ------------------------------------------------------------------ */

export type TransferDirection = "in" | "out";

/** Is this movement bringing stock into the warehouse, or sending it out? */
export function transferDirection(t: Transfer, warehouseId: string): TransferDirection {
  const toHere =
    t.toType === LocationType.WAREHOUSE && t.toId === warehouseId;
  if (t.type === TransferType.RECEIVE || toHere) return "in";
  return "out";
}

export function transferUnits(t: Transfer): number {
  return t.items.reduce((n, i) => n + i.quantity, 0);
}

/* ------------------------------------------------------------------ *
 * Containers
 * ------------------------------------------------------------------ */

export function containerLabel(c: Pick<Container, "technicianName">): string {
  return c.technicianName || "Container";
}
