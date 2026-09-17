import type { MyContainer, StockItem, StockRow } from './types';

/**
 * The van list, as arithmetic and string handling only.
 *
 * Kept pure and apart from the screen for the same reason `jobs/lib.ts` is:
 * "what does searching for `3/4 valve` find?" should be a test, not a thing
 * somebody re-checks by hand on a phone.
 */

/* ------------------------------------------------------------------- rows */

/**
 * Stock rows as the list shows them: what is actually on the van, by name.
 *
 * **Deliberately not joined to the product catalog.** The web's page enriches
 * each row with SKU, category and a low-stock mark by paging the entire
 * catalog first (`warehouses/api.ts:85` walks `GET /inventory/products` 100 at
 * a time, up to 5,000 — and this company's export has ~3,000 stock lines per
 * location). That is fifty round trips before a list appears, which is a fair
 * trade in a browser on an office desk and the wrong one entirely on a van
 * phone at one bar. There is no fetch-many-products-by-id endpoint to do it
 * cheaply with, so this pass shows what the stock row already carries and
 * says nothing it cannot back up. `StockRow` is the seam: a later pass that
 * gets a batch endpoint adds the fields here and the screen follows.
 */
export function toStockRows(items: StockItem[]): StockRow[] {
  return items
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      productId: s.productId,
      name: s.productName?.trim() || 'Unnamed part',
      quantity: s.quantity,
    }));
}

/**
 * Filter by what the technician typed. Every word has to match something, so
 * "3/4 valve" finds the 3/4" valve even when the words are far apart in the
 * name — the same rule as the web's `filterStockRows`
 * (`apps/web/features/tech/lib.ts:227`), so a part found on the desk is found
 * in the van.
 */
export function filterStock(rows: StockRow[], query: string): StockRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((r) => {
    const haystack = r.name.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/**
 * A–Z by name.
 *
 * The web floats low stock to the top, because a low row is the one that needs
 * doing something about. Nothing here knows what "low" is (no catalog, no
 * `minimumStockLevel`), and inventing a threshold would put a mark next to
 * parts that are perfectly well stocked. So the order is the one a person
 * scanning a list expects, and it stays stable as quantities change under it.
 */
export function sortStock(rows: StockRow[]): StockRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------------- summary */

export interface StockSummary {
  /** How many different parts — the "12 items" half. */
  skuCount: number;
  /** How many pieces in total — the "148 on hand" half. */
  totalUnits: number;
}

export function summarizeStock(rows: StockRow[]): StockSummary {
  return {
    skuCount: rows.length,
    totalUnits: rows.reduce((n, r) => n + r.quantity, 0),
  };
}

/**
 * "12 items · 148 on hand", or "1 item · 1 on hand" — a technician reads this
 * at a glance at the back of the van, so it is words, not two bare numbers.
 */
export function summaryLine({ skuCount, totalUnits }: StockSummary): string {
  const items = `${skuCount} item${skuCount === 1 ? '' : 's'}`;
  return `${items} · ${totalUnits.toLocaleString()} on hand`;
}

/* -------------------------------------------------------------- container */

/**
 * What to call the van. The office names containers after the technician as
 * often as after the truck, so an unnamed one falls back to the technician's
 * own name before it falls back to the word — the same order as the web's
 * `containerTitle` (`containers/lib.ts:7`).
 */
export function containerTitle(
  container: Pick<MyContainer, 'name' | 'technicianName'>,
): string {
  return container.name?.trim() || container.technicianName?.trim() || 'My van';
}

/** The quiet line under the title: the department, when the van has one. */
export function containerSubtitle(
  container: Pick<MyContainer, 'department'>,
): string | undefined {
  return container.department?.trim() || undefined;
}
