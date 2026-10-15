import type { QueryClient } from "@tanstack/react-query";
import { calculateDocumentTotals } from "@bitcrm/types";
import type { Deal, DealProduct, DealTotalsSnapshot, DocumentTotals } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";

/**
 * A line write (add, edit, remove, a flag) moves three cached answers at
 * once: the job's lines, the job itself — its item count and money snapshot,
 * what the tab strip and the quick view print — and the totals under the
 * table. The page then shows one frame, in the same tick as the save
 * returns (or the click, for a removal), instead of three repaints as three
 * rereads land. The rereads still follow and bring the same numbers: the
 * formula here is the server's (`calculateDocumentTotals`, `dealTotalsSnapshot`).
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Σ quantity × company cost over the lines — the job's Company Cost (Workiz `company_parts`). */
function linesCost(lines: DealProduct[]): number {
  const cents = lines.reduce(
    (sum, l) => sum + Math.round((Number(l.quantity) || 0) * Math.round(((Number(l.costCompany) || 0) + Number.EPSILON) * 100)),
    0,
  );
  return cents / 100;
}

export function applyLineWrite(
  qc: QueryClient,
  dealId: string,
  update: (lines: DealProduct[]) => DealProduct[],
): DealProduct[] {
  const lines = update(qc.getQueryData<DealProduct[]>(queryKeys.deals.products(dealId)) ?? []);
  qc.setQueryData<DealProduct[]>(queryKeys.deals.products(dealId), lines);

  const deal = qc.getQueryData<Deal>(queryKeys.deals.detail(dealId));
  if (!deal) return lines;

  const t = calculateDocumentTotals({ lines, taxRatePercent: deal.taxRatePercent ?? 0, discount: deal.discount });
  const cost = linesCost(lines);
  const totals: DealTotalsSnapshot = {
    subtotal: t.subtotal,
    discount: t.discount,
    tax: t.tax,
    total: t.total,
    cost,
    taxableBase: t.taxableBase,
  };
  // Company Cost follows the lines while there are any; when the last one goes,
  // the sum the lines gave goes with it and a typed amount stays — the server's rule.
  const linesGaveIt = lines.length === 0 && deal.companyCost !== undefined && deal.companyCost !== 0 && deal.companyCost === deal.totals?.cost;
  qc.setQueryData<Deal>(queryKeys.deals.detail(dealId), {
    ...deal,
    itemCount: lines.length,
    totals,
    ...(lines.length > 0 ? { companyCost: round2(cost) } : linesGaveIt ? { companyCost: 0 } : {}),
  });

  const old = qc.getQueryData<DocumentTotals>(queryKeys.dealTotals(dealId));
  if (old) {
    const amountPaid = old.amountPaid ?? 0;
    qc.setQueryData<DocumentTotals>(queryKeys.dealTotals(dealId), {
      ...old,
      ...t,
      lineCount: lines.length,
      amountPaid,
      balanceDue: round2(t.total - amountPaid),
    });
  }
  return lines;
}

export interface LineCacheSnapshot {
  lines?: DealProduct[];
  deal?: Deal;
  totals?: DocumentTotals;
}

/** The three answers as they are — to put back when the server refuses the write. */
export function snapshotLineCache(qc: QueryClient, dealId: string): LineCacheSnapshot {
  return {
    lines: qc.getQueryData<DealProduct[]>(queryKeys.deals.products(dealId)),
    deal: qc.getQueryData<Deal>(queryKeys.deals.detail(dealId)),
    totals: qc.getQueryData<DocumentTotals>(queryKeys.dealTotals(dealId)),
  };
}

export function restoreLineCache(qc: QueryClient, dealId: string, snap: LineCacheSnapshot): void {
  if (snap.lines !== undefined) qc.setQueryData(queryKeys.deals.products(dealId), snap.lines);
  if (snap.deal !== undefined) qc.setQueryData(queryKeys.deals.detail(dealId), snap.deal);
  if (snap.totals !== undefined) qc.setQueryData(queryKeys.dealTotals(dealId), snap.totals);
}
