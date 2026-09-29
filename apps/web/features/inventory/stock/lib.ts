import { InventoryStatus } from "@bitcrm/types";
import type { Container, LocationSummaryType, Transfer, Warehouse } from "@bitcrm/types";
import { transferUnits, type StockSummary } from "@/features/inventory/warehouses/lib";
import { containerTitle } from "@/features/inventory/containers/lib";

/* ------------------------------------------------------------------ *
 * Locations — every warehouse and van, as a picker lists them.
 * ------------------------------------------------------------------ */

export interface StockLocation {
  type: LocationSummaryType;
  id: string;
  name: string;
  description?: string;
  status: InventoryStatus;
  /** Containers only. */
  technicianId?: string;
  technicianName?: string;
  department?: string;
}

/** Warehouses first, then containers — the order the stock popup uses too. */
export function toLocations(warehouses: Warehouse[], containers: Container[]): StockLocation[] {
  return [
    ...warehouses.map((w) => ({
      type: "warehouse" as const,
      id: w.id,
      name: w.name,
      description: w.description,
      status: w.status,
    })),
    ...containers.map((c) => ({
      type: "container" as const,
      id: c.id,
      name: containerTitle(c),
      description: c.description,
      status: c.status,
      technicianId: c.technicianId,
      technicianName: c.technicianName,
      department: c.department,
    })),
  ];
}

/* ------------------------------------------------------------------ *
 * Toasts — what moved, and what the server left behind.
 * ------------------------------------------------------------------ */

export type Movement = "receive" | "move" | "return";

function units(n: number): string {
  return `${n} ${n === 1 ? "unit" : "units"}`;
}

/**
 * Counted from the answer, not the request: an item that is not
 * stock-managed comes back in `skippedItems` and did not move.
 */
export function movementMessages(
  kind: Movement,
  t: Transfer,
): { success: string; warning?: string } {
  const n = units(transferUnits(t));
  const success =
    kind === "receive" ? `Added ${n} to stock` : kind === "move" ? `Moved ${n}` : `Returned ${n}`;
  const skipped = t.skippedItems ?? [];
  return skipped.length
    ? { success, warning: `Not stock-managed, skipped: ${skipped.map((i) => i.productName).join(", ")}` }
    : { success };
}

/* ------------------------------------------------------------------ *
 * Stock actions — add / move / return one item in one location.
 * ------------------------------------------------------------------ */

/**
 * What a stock action works on. The item's popup lists locations and the
 * location's popup lists items; both hand the same three things over.
 */
export interface StockTarget {
  product: { id: string; name: string };
  location: { type: LocationSummaryType; id: string; name: string };
  /** What the location holds now — the most Move and Return may take. */
  available: number;
}

/* ------------------------------------------------------------------ *
 * The Manage stock popup — cards, search, paging.
 * ------------------------------------------------------------------ */

function cents(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

function money(n: number): string {
  return n < 0 ? `-$${cents(-n)}` : `$${cents(n)}`;
}

/**
 * The three cards, formatted the way Workiz prints them: "369.00" on hand,
 * "$7439.04" of cost — two decimals, no thousands separator.
 */
export function stockSummary(
  onHand: number,
  prices: { costCompany: number; priceClient: number },
): { onHand: string; cost: string; sale: string } {
  return {
    onHand: cents(onHand),
    cost: money(onHand * (prices.costCompany || 0)),
    sale: money(onHand * (prices.priceClient || 0)),
  };
}

/**
 * A typed quantity for add / move / return: a whole number, at least 1 and,
 * when stock leaves a location, no more than it holds. An empty field has no
 * error — the submit button is simply off until there is a number.
 */
export function checkQuantity(
  raw: string,
  max?: number,
): { quantity: number | null; error: string | null } {
  const text = raw.trim();
  if (!text) return { quantity: null, error: null };
  const n = Number(text);
  if (!Number.isInteger(n)) return { quantity: null, error: "Whole units only" };
  if (n < 1) return { quantity: null, error: "Enter 1 or more" };
  if (max !== undefined && n > max) return { quantity: null, error: `Only ${max} available` };
  return { quantity: n, error: null };
}

/**
 * A warehouse's or van's popup: how many different items, how many units,
 * and what they sell for. The value comes from the catalog join — without it
 * every row would count as $0, so it shows "—" instead.
 */
export function locationCards(
  summary: StockSummary,
  priced: boolean,
): { skus: string; units: string; value: string } {
  return {
    skus: String(summary.skuCount),
    units: String(Math.round(summary.totalUnits)),
    value: priced ? money(summary.totalValue) : "—",
  };
}

/** The popup's search box: name or description, ignoring case. */
export function filterStockRows<T extends { name: string; description?: string }>(
  rows: T[],
  term: string,
): T[] {
  const q = term.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q),
  );
}

/** A location popup's search box: the item's name or SKU, ignoring case. */
export function filterItemRows<T extends { name: string; sku?: string }>(rows: T[], term: string): T[] {
  const q = term.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q),
  );
}

/**
 * One page of a list the endpoint returns whole. A page past the end (the
 * list shrank under a search) falls back to the last one.
 */
export function pageSlice<T>(
  rows: T[],
  page: number,
  size: number,
): { rows: T[]; page: number; pages: number; from: number; to: number; total: number } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pages,
    from: total ? start + 1 : 0,
    to: start + slice.length,
    total,
  };
}

/**
 * Where stock can go from `from`: every other location still in use. The
 * source is matched by type and id — a warehouse and a van may share an id.
 */
export function moveTargets(
  locations: StockLocation[],
  from: { type: LocationSummaryType; id: string },
): { warehouses: StockLocation[]; containers: StockLocation[] } {
  const open = locations.filter(
    (l) => l.status !== InventoryStatus.ARCHIVED && !(l.type === from.type && l.id === from.id),
  );
  return {
    warehouses: open.filter((l) => l.type === "warehouse"),
    containers: open.filter((l) => l.type === "container"),
  };
}

/** A van's second line in a picker: whose it is and which department. */
export function locationHint(l: StockLocation): string {
  const tech = l.technicianName?.trim();
  return [tech && tech !== l.name ? tech : undefined, l.department?.trim() || undefined]
    .filter(Boolean)
    .join(" · ");
}
