import {
  InventoryStatus,
  type Container,
  type ContainerVan,
  type Warehouse,
} from "@bitcrm/types";

/** Everything stock can sit in. Warehouses are rooms; containers are vans. */
export type LocationKind = "warehouse" | "container";

export interface LocationRow {
  id: string;
  kind: LocationKind;
  name: string;
  description: string;
  active: boolean;
  href: string;
}

/**
 * A one-line description of the vehicle.
 *
 * Workiz has no van fields — the VIN, plate and state get typed into the
 * location's free-text description ("3N6CM0KN1MK697538 C028196 Connecticut").
 * Ours are structured, so the same line is composed from real fields and the
 * blanks simply drop out.
 */
export function vanDescription(van?: ContainerVan): string {
  if (!van) return "";
  const vehicle = [van.year, van.make, van.model].filter(Boolean).join(" ");
  return [
    vehicle,
    van.vin ? `VIN ${van.vin}` : "",
    van.licensePlate ? `Plate ${van.licensePlate}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * The one list the Locations screen renders. Warehouses lead — the shop is
 * where stock arrives — then the vans, each alphabetical within its group.
 */
export function toLocationRows(
  warehouses: Warehouse[] | undefined,
  containers: Container[] | undefined,
): LocationRow[] {
  const warehouseRows: LocationRow[] = (warehouses ?? []).map((w) => ({
    id: w.id,
    kind: "warehouse",
    name: w.name,
    description: w.description || w.address || "",
    active: w.status === InventoryStatus.ACTIVE,
    href: `/inventory/warehouses/${w.id}`,
  }));

  const containerRows: LocationRow[] = (containers ?? []).map((c) => ({
    id: c.id,
    kind: "container",
    // Older containers predate the name field and still label off the tech.
    name: c.name?.trim() || c.technicianName,
    description: vanDescription(c.van),
    active: c.status === InventoryStatus.ACTIVE,
    href: `/inventory/containers/${c.id}`,
  }));

  return [...warehouseRows.sort(byName), ...containerRows.sort(byName)];
}

export function searchLocations(rows: LocationRow[], query: string): LocationRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
  );
}

export interface StockValueInput {
  quantity: number;
  cost?: number;
  price?: number;
}

export interface StockValueTotals {
  onHand: number;
  totalCost: number;
  saleValue: number;
}

const cents = (amount: number | undefined) => Math.round((amount ?? 0) * 100);

/**
 * Totals for the Manage stock header. Money is added in whole cents — Workiz
 * adds it in floats and prints "Total Items cost: 7256.822500000001" on this
 * very screen.
 */
export function summarizeStockValue(rows: StockValueInput[]): StockValueTotals {
  let onHand = 0;
  let costCents = 0;
  let saleCents = 0;

  for (const row of rows) {
    onHand += row.quantity;
    costCents += cents(row.cost) * row.quantity;
    saleCents += cents(row.price) * row.quantity;
  }

  return { onHand, totalCost: costCents / 100, saleValue: saleCents / 100 };
}
