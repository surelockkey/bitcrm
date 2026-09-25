import {
  calculateDocumentTotals,
  type Deal,
  type DealProduct,
  type DealTotalsSnapshot,
} from '@bitcrm/types';

const cents = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) : 0;

/** What the job is worth and what its lines cost — the snapshot stored on the deal. */
export function dealTotalsSnapshot(
  deal: Pick<Deal, 'taxRatePercent' | 'discount'>,
  lines: DealProduct[],
): DealTotalsSnapshot {
  const t = calculateDocumentTotals({
    lines,
    taxRatePercent: deal.taxRatePercent ?? 0,
    discount: deal.discount,
  });
  const costCents = lines.reduce(
    (sum, l) => sum + Math.round((Number(l.quantity) || 0) * cents(l.costCompany)),
    0,
  );
  return { subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total, cost: costCents / 100 };
}

const TOTAL_KEYS: (keyof DealTotalsSnapshot)[] = ['subtotal', 'discount', 'tax', 'total', 'cost'];

/** The backfill's write for one job, or null when what it stores is already right. */
export function totalsBackfillUpdate(
  stored: Pick<Deal, 'itemCount' | 'totals'>,
  itemCount: number,
  totals: DealTotalsSnapshot,
): { itemCount: number; totals: DealTotalsSnapshot } | null {
  const same =
    stored.itemCount === itemCount &&
    !!stored.totals &&
    TOTAL_KEYS.every((k) => stored.totals![k] === totals[k]);
  return same ? null : { itemCount, totals };
}
