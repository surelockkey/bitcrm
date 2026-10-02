import {
  ESTIMATE_STATUSES,
  calculateDocumentTotals,
  type DocumentTotals,
  type Estimate,
  type EstimateItem,
  type EstimateStatus,
} from "@bitcrm/types";
import { toneClasses } from "@/lib/theme/tone";
import type { EstimateItemBody } from "./schemas";
import { DEFAULT_TZ } from "@/lib/timezone";

export const ESTIMATE_STATUS_META: Record<EstimateStatus, { label: string; className: string }> = {
  unsent: {
    label: "Unsent",
    className: toneClasses("neutral"),
  },
  pending: {
    label: "Pending",
    className: toneClasses("warning"),
  },
  approved: {
    label: "Approved",
    className: toneClasses("info"),
  },
  declined: {
    label: "Declined",
    className: toneClasses("destructive"),
  },
  won: {
    label: "Won",
    className: toneClasses("success"),
  },
  archived: {
    label: "Archived",
    className: toneClasses("neutral"),
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
  hasJob = true,
): string | null {
  if (!canSync) return "You don't have permission to sync estimates to jobs";
  // Workiz's "stub": a client's estimate with no job has nowhere to sync to.
  if (!hasJob) return "This estimate has no job — create a job for the client first";
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

/** PUT body for an existing line (an estimate's or a client invoice's), with some fields changed. */
export function itemBodyFrom(
  item: Pick<
    EstimateItem,
    "productId" | "productType" | "name" | "sku" | "description" | "quantity" | "priceClient" | "costCompany" | "costForTech" | "taxable"
  >,
  changes: Partial<EstimateItemBody>,
): EstimateItemBody {
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

/**
 * The Created column of a job's Estimates list, as Workiz prints it:
 * "Thu Oct 01, 2026 11:03 am", in the account's zone. Empty for a missing or
 * broken date rather than "Invalid Date".
 */
export function formatEstimateCreated(iso: string, tz: string = DEFAULT_TZ): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

/**
 * What Workiz's "Send all (Proposal)" does for a job's estimates. Open
 * estimates no proposal holds yet become a new proposal (`new`). When every
 * open one is already in a proposal, the button stays and resends that
 * proposal's portal link (`resend`): the proposal is created before the
 * message goes out, so a failed email used to leave nothing to retry with.
 * `count` is how many options the client would see.
 */
export function proposalSend(
  estimates: Array<Pick<Estimate, "status" | "proposalId">>,
): { mode: "new" | "resend" | null; count: number } {
  const open = estimates.filter((e) => e.status === "unsent" || e.status === "pending");
  const fresh = open.filter((e) => !e.proposalId).length;
  if (fresh > 0) return { mode: "new", count: fresh };
  if (open.length > 0) return { mode: "resend", count: open.length };
  return { mode: null, count: 0 };
}
