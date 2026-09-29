import type {
  Container,
  InventoryStatus,
  LocationSummaryType,
  Transfer,
  Warehouse,
} from "@bitcrm/types";
import { transferUnits } from "@/features/inventory/warehouses/lib";
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
