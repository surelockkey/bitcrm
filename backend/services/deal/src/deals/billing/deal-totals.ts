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
  return {
    subtotal: t.subtotal,
    discount: t.discount,
    tax: t.tax,
    total: t.total,
    cost: costCents / 100,
    // What the tax was taken of — the Tax report's Taxable Amount.
    taxableBase: t.taxableBase,
  };
}

/**
 * Finance "Total" typed by hand on a job with no line items (Workiz
 * `job_total_price`): the whole snapshot is that amount — nothing to
 * discount, tax or cost — and it says so, for `refreshTotals` to replace once
 * a line exists.
 */
export function manualTotalSnapshot(total: number): DealTotalsSnapshot {
  const amount = cents(total) / 100;
  return { subtotal: amount, discount: 0, tax: 0, total: amount, cost: 0, taxableBase: 0, manual: true };
}

const dollars = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * The job's Tech Cost and Company Cost as stored: under our names, else under
 * the Workiz names the importer wrote them with (`parts`, `companyParts`).
 * Absent keys stay absent.
 */
export function jobCostsOf(item: Record<string, unknown>): Pick<Deal, 'techCost' | 'companyCost'> {
  const techCost = dollars(item.techCost) ?? dollars(item.parts);
  const companyCost = dollars(item.companyCost) ?? dollars(item.companyParts);
  return { ...(techCost !== undefined && { techCost }), ...(companyCost !== undefined && { companyCost }) };
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
