import { LocationType, ReturnReason, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";

export { transferUnits } from "@/features/inventory/warehouses/lib";

/* ---- Types ---- */

const TYPE_LABELS: Record<TransferType, string> = {
  [TransferType.RECEIVE]: "Receive",
  [TransferType.TRANSFER]: "Transfer",
  [TransferType.DEDUCT]: "Deduct",
  [TransferType.RESTORE]: "Restore",
  [TransferType.RETURN]: "Return",
};

export function transferTypeLabel(t: TransferType): string {
  return TYPE_LABELS[t] ?? t;
}

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  [ReturnReason.RECALL]: "Recall",
  [ReturnReason.DAMAGED]: "Damaged",
  [ReturnReason.LOST]: "Lost",
  [ReturnReason.OTHER]: "Other",
};

export function returnReasonLabel(r: ReturnReason): string {
  return RETURN_REASON_LABELS[r] ?? r;
}

/** Deduct/Restore are created automatically by the deal service. */
export function isAutoType(t: TransferType): boolean {
  return t === TransferType.DEDUCT || t === TransferType.RESTORE;
}

/* ---- Endpoint resolution (a transfer stores ids, not names) ---- */

export type EndpointKind = "warehouse" | "container" | "supplier" | "deal" | "return" | "unknown";

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

/**
 * Both ends of a movement. The side without a location is a job for a
 * deduct/restore (its own `dealId`, or the "Deal: …" note older records carry)
 * and the reason for a return — a return's note is free text and never a job.
 */
export function transferEndpoints(
  t: Transfer,
  locationMap: Map<string, string>,
): { from: ResolvedEndpoint; to: ResolvedEndpoint } {
  const side = (type: LocationType | null, id: string | null): ResolvedEndpoint => {
    if (type) return resolveEndpoint(type, id, t.notes, locationMap);
    if (t.type === TransferType.RETURN) {
      return { kind: "return", name: t.reason ? returnReasonLabel(t.reason) : "Returned" };
    }
    if (t.dealId) return { kind: "deal", name: t.dealId, dealId: t.dealId };
    return resolveEndpoint(null, null, t.notes, locationMap);
  };
  return { from: side(t.fromType, t.fromId), to: side(t.toType, t.toId) };
}
