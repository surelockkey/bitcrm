import { JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";

/* --------------------------------------------------------------- actions */

/** Statuses a technician is finished with. */
const CLOSED: ReadonlySet<JobSuperStatus> = new Set([
  JobSuperStatus.DONE,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  JobSuperStatus.CANCELED,
]);

export const isClosedJob = (d: Pick<Deal, "superStatus">): boolean => CLOSED.has(d.superStatus);

/**
 * Which technician actions a job offers, from what has already happened to
 * it. Mirrors the Workiz mobile flow: confirm receipt → on my way → arrived →
 * start (In Progress) → done. A closed job offers nothing.
 */
export interface TechActionState {
  /** "Confirm receipt" — until somebody has acknowledged the job. */
  canConfirm: boolean;
  /** "On my way" / "Running late" texts to the client — while the job is open. */
  canNotify: boolean;
  /** "Arrived" — once, on an open job. */
  canArrive: boolean;
  /** "Start" — Submitted → In Progress. */
  canStart: boolean;
  /** "Done" — In Progress (or Pending) → Done. */
  canFinish: boolean;
}

export function techActionState(deal: Pick<Deal, "superStatus" | "techConfirmedAt" | "arrivedAt">): TechActionState {
  const closed = isClosedJob(deal);
  return {
    canConfirm: !closed && !deal.techConfirmedAt,
    canNotify: !closed,
    canArrive: !closed && !deal.arrivedAt,
    canStart: deal.superStatus === JobSuperStatus.SUBMITTED,
    canFinish: deal.superStatus === JobSuperStatus.IN_PROGRESS || deal.superStatus === JobSuperStatus.PENDING,
  };
}

/* ----------------------------------------------------------------- stock */

/** The fields "My stock" searches on — name, SKU, category. */
export interface SearchableStockRow {
  name: string;
  sku?: string;
  category?: string;
}

/**
 * Filter the van's stock by what the technician typed. Every word has to
 * match something — a part is found by name, by the number on the box (SKU),
 * or by the shelf it lives on (category), and "3/4 valve" finds the 3/4"
 * valve even though the two words come from different fields.
 */
export function filterStockRows<T extends SearchableStockRow>(rows: T[], query: string): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((r) => {
    const haystack = [r.name, r.sku, r.category].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** Low stock first (that is what needs a restock), then by name. */
export function sortStockRows<T extends SearchableStockRow & { isLow: boolean }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Number(b.isLow) - Number(a.isLow) || a.name.localeCompare(b.name),
  );
}
