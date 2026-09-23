import {
  ESTIMATE_STATUSES,
  calculateDocumentTotals,
  type DocumentTotals,
  type Estimate,
  type EstimateItem,
  type EstimateStatus,
} from "@bitcrm/types";
import type { EstimateItemBody } from "./schemas";

export const ESTIMATE_STATUS_META: Record<EstimateStatus, { label: string; className: string }> = {
  unsent: {
    label: "Unsent",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  pending: {
    label: "Pending",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  approved: {
    label: "Approved",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  declined: {
    label: "Declined",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  won: {
    label: "Won",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  archived: {
    label: "Archived",
    className: "border-zinc-500/30 bg-zinc-500/5 text-zinc-500 dark:text-zinc-400",
  },
};

export function estimateStatusLabel(status: EstimateStatus): string {
  return ESTIMATE_STATUS_META[status]?.label ?? status;
}

export function estimateTitle(e: Pick<Estimate, "number" | "name">): string {
  return e.name ? `Estimate #${e.number} · ${e.name}` : `Estimate #${e.number}`;
}

export interface EstimateListParams {
  status?: EstimateStatus;
  contactId?: string;
  dealId?: string;
  limit?: number;
  cursor?: string;
}

export function buildEstimateListQuery(p: EstimateListParams): string {
  const q = new URLSearchParams();
  if (p.status) q.set("status", p.status);
  if (p.contactId) q.set("contactId", p.contactId);
  if (p.dealId) q.set("dealId", p.dealId);
  if (p.limit) q.set("limit", String(p.limit));
  if (p.cursor) q.set("cursor", p.cursor);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/* -------------------------------------------------------------- summary */

export interface StatusBucket {
  count: number;
  amount: number;
}
export type EstimateSummary = Record<EstimateStatus | "all", StatusBucket>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function bucketOf(v: unknown): StatusBucket | null {
  if (!isRecord(v)) return null;
  if (!("count" in v) && !("amount" in v)) return null;
  return { count: num(v.count), amount: num(v.amount ?? v.total) };
}

/**
 * The contract only says "counts/amounts per status", so accept the likely
 * shapes: `{status: {count, amount}}`, `{byStatus: …}`, `[{status, count,
 * amount}]`, `{counts, amounts}` and flat `{pendingCount, pendingAmount}`.
 */
export function normalizeEstimateSummary(raw: unknown): EstimateSummary {
  const out = Object.fromEntries(
    [...ESTIMATE_STATUSES, "all"].map((s) => [s, { count: 0, amount: 0 }]),
  ) as EstimateSummary;

  const src: unknown = isRecord(raw) && isRecord(raw.byStatus) ? raw.byStatus : raw;

  for (const s of ESTIMATE_STATUSES) {
    let b: StatusBucket | null = null;
    if (Array.isArray(src)) {
      b = bucketOf(src.find((r) => isRecord(r) && r.status === s));
    } else if (isRecord(src)) {
      b = bucketOf(src[s]);
      if (!b && isRecord(src.counts)) {
        b = { count: num(src.counts[s]), amount: isRecord(src.amounts) ? num(src.amounts[s]) : 0 };
      }
      if (!b && (`${s}Count` in src || `${s}Amount` in src)) {
        b = { count: num(src[`${s}Count`]), amount: num(src[`${s}Amount`]) };
      }
    }
    if (b) out[s] = b;
    out.all = { count: out.all.count + out[s].count, amount: out.all.amount + out[s].amount };
  }
  out.all.amount = Math.round(out.all.amount * 100) / 100;
  return out;
}

/* ----------------------------------------------------------------- sync */

export function syncBlockReason(
  estimate: Pick<Estimate, "status">,
  itemCount: number,
  canSync: boolean,
): string | null {
  if (!canSync) return "You don't have permission to sync estimates to jobs";
  if (estimate.status === "archived") return "Archived estimates can't be synced";
  if (itemCount < 1) return "Add at least one item to the estimate first";
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function syncConfirmText(jobItems: number, estimateItems: number): string {
  return (
    `This replaces the job's ${plural(jobItems, "current item")} with the estimate's ${plural(estimateItems, "item")}. ` +
    "Parts are pulled from the assigned technician's stock when available, otherwise marked to order."
  );
}

/* --------------------------------------------------------------- items */

/** Same formula as the server; used while the server totals are refetching. */
export function estimateLocalTotals(
  e: Pick<Estimate, "taxRatePercent" | "discount" | "taxSource">,
  items: Pick<EstimateItem, "quantity" | "priceClient" | "taxable">[],
): DocumentTotals {
  return calculateDocumentTotals({
    lines: items,
    taxRatePercent: e.taxSource === "exempt" ? 0 : e.taxRatePercent,
    discount: e.discount,
  });
}

export function reorderLineIds(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** PUT body for an existing line, with some fields changed. */
export function itemBodyFrom(item: EstimateItem, changes: Partial<EstimateItemBody>): EstimateItemBody {
  return {
    productId: item.productId,
    productType: item.productType,
    name: item.name,
    sku: item.sku,
    description: item.description,
    quantity: item.quantity,
    priceClient: item.priceClient,
    costCompany: item.costCompany,
    costForTech: item.costForTech,
    taxable: item.taxable,
    ...changes,
  };
}
