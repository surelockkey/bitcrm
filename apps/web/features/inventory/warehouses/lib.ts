import type { Transfer } from "@bitcrm/types";

export { formatMoney } from "@/features/inventory/products/lib";

/* ------------------------------------------------------------------ *
 * A location's stock as the views read it. The server names and prices
 * the rows (`GET /stock/locations/:type/:id`); `stockRowsOf` maps them.
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

export function transferUnits(t: Transfer): number {
  return t.items.reduce((n, i) => n + i.quantity, 0);
}
