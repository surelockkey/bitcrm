import { LocationType, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";

export { transferUnits } from "@/features/inventory/warehouses/lib";

/* ---- Types ---- */

const TYPE_LABELS: Record<TransferType, string> = {
  [TransferType.RECEIVE]: "Receive",
  [TransferType.TRANSFER]: "Transfer",
  [TransferType.DEDUCT]: "Deduct",
  [TransferType.RESTORE]: "Restore",
};

export function transferTypeLabel(t: TransferType): string {
  return TYPE_LABELS[t] ?? t;
}

/** Deduct/Restore are created automatically by the deal service. */
export function isAutoType(t: TransferType): boolean {
  return t === TransferType.DEDUCT || t === TransferType.RESTORE;
}

/* ---- Endpoint resolution (a transfer stores ids, not names) ---- */

export type EndpointKind = "warehouse" | "container" | "supplier" | "deal" | "unknown";

export interface ResolvedEndpoint {
  kind: EndpointKind;
  name: string;
  id?: string;
  dealId?: string;
}

/** Deal deduct/restore carry the deal id in `notes` (e.g. "Deal: DEAL-1042"). */
export function parseDealId(notes?: string): string | undefined {
  if (!notes) return undefined;
  const m = notes.match(/Deal:\s*(\S+)/i);
  return m?.[1];
}

export function resolveEndpoint(
  type: LocationType | null,
  id: string | null,
  notes: string | undefined,
  locationMap: Map<string, string>,
): ResolvedEndpoint {
  if (type === LocationType.SUPPLIER) return { kind: "supplier", name: "Supplier" };
  if (type === LocationType.WAREHOUSE) {
    return { kind: "warehouse", id: id ?? undefined, name: (id && locationMap.get(id)) || "Warehouse" };
  }
  if (type === LocationType.CONTAINER) {
    return { kind: "container", id: id ?? undefined, name: (id && locationMap.get(id)) || "Container" };
  }
  // Null side = a deal (deduct/restore).
  const dealId = parseDealId(notes);
  if (dealId) return { kind: "deal", name: dealId, dealId };
  return { kind: "unknown", name: "—" };
}

/* ---- Filtering ---- */

export function filterByType(
  transfers: Transfer[],
  type: TransferType | "all",
): Transfer[] {
  if (type === "all") return transfers;
  return transfers.filter((t) => t.type === type);
}

/** Client-side search over items, performer, and resolved location names. */
export function matchesSearch(
  t: Transfer,
  q: string,
  locationMap: Map<string, string>,
): boolean {
  if (!q) return true;
  const from = resolveEndpoint(t.fromType, t.fromId, t.notes, locationMap).name;
  const to = resolveEndpoint(t.toType, t.toId, t.notes, locationMap).name;
  const hay = [
    t.performedByName,
    from,
    to,
    t.notes ?? "",
    ...t.items.map((i) => i.productName),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}
