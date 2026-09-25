import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/** The deal service's live stream (`GET /deals/stream`). */
export const DEALS_STREAM_PATH = "/deals/stream";

/** "Something about this job changed" — the id only; the rest is reread. */
export interface DealChangedEvent {
  type: "deal.changed";
  dealId: string;
  at: string;
}

/** Cheap shape check on a `data:` frame — a malformed one is dropped, not thrown. */
export function parseDealFrame(data: string): DealChangedEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const e = parsed as Partial<DealChangedEvent> | null;
  if (!e || e.type !== "deal.changed" || typeof e.dealId !== "string") return null;
  return e as DealChangedEvent;
}

/**
 * One save fires several frames (a status move, its timeline, the tech's
 * sequence), and a board holds dozens of jobs: collect them for a moment
 * and refetch every job query once. Only the ones on screen actually
 * refetch — the rest are just marked stale.
 */
export function createDealChangeBatcher(qc: QueryClient, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    changed() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
      }, delayMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
