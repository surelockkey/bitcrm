import type { TaxRate } from '../entities/tax-rate.entity';

/**
 * Where a job's/estimate's tax rate came from.
 * - `service_area` — the job's service area default tax.
 * - `default`      — the account default tax rate.
 * - `manual`       — picked by a user; service-area changes no longer override it.
 * - `exempt`       — the client is tax-exempt; no tax.
 * - `none`         — nothing configured.
 */
export type DocumentTaxSource = 'service_area' | 'default' | 'manual' | 'exempt' | 'none';

/** One document-level discount (Workiz: $ amount or % of the subtotal). */
export interface DocumentDiscount {
  type: 'amount' | 'percent';
  value: number;
}

export interface TotalsLine {
  quantity: number;
  priceClient: number;
  /** Absent ⇒ taxable. */
  taxable?: boolean;
}

export interface DocumentTotals {
  lineCount: number;
  subtotal: number;
  taxableSubtotal: number;
  nonTaxableSubtotal: number;
  discount: number;
  /** Taxable subtotal minus its proportional share of the discount. */
  taxableBase: number;
  taxRatePercent: number;
  tax: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
}

export interface TotalsInput {
  lines: TotalsLine[];
  taxRatePercent?: number;
  discount?: DocumentDiscount;
  amountPaid?: number;
}

const toCents = (dollars: number): number => Math.round((dollars + Number.EPSILON) * 100);
const toDollars = (cents: number): number => Math.round(cents) / 100;
const safe = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Line amount (quantity × price) rounded to cents, in dollars. */
export function lineAmount(line: Pick<TotalsLine, 'quantity' | 'priceClient'>): number {
  return toDollars(toCents(safe(line.quantity) * safe(line.priceClient)));
}

/**
 * The single totals formula shared by the API, the web app and the PDF
 * renderer. Order: subtotal → discount (split proportionally between taxable
 * and non-taxable lines) → tax on the discounted taxable base → total.
 * Everything is computed in integer cents with half-up rounding.
 */
export function calculateDocumentTotals(input: TotalsInput): DocumentTotals {
  let taxableCents = 0;
  let nonTaxableCents = 0;
  for (const line of input.lines) {
    const cents = toCents(safe(line.quantity) * safe(line.priceClient));
    if (line.taxable === false) nonTaxableCents += cents;
    else taxableCents += cents;
  }
  const subtotalCents = taxableCents + nonTaxableCents;

  let discountCents = 0;
  const d = input.discount;
  if (d && safe(d.value) > 0) {
    discountCents =
      d.type === 'percent'
        ? Math.round((subtotalCents * Math.min(100, safe(d.value))) / 100)
        : toCents(safe(d.value));
  }
  discountCents = Math.max(0, Math.min(discountCents, subtotalCents));

  const taxableDiscountCents =
    subtotalCents > 0 ? Math.round((discountCents * taxableCents) / subtotalCents) : 0;
  const taxableBaseCents = taxableCents - taxableDiscountCents;

  const ratePercent = Math.max(0, safe(input.taxRatePercent));
  const taxCents = Math.round((taxableBaseCents * ratePercent) / 100);

  const totalCents = subtotalCents - discountCents + taxCents;
  const paidCents = toCents(Math.max(0, safe(input.amountPaid)));

  return {
    lineCount: input.lines.length,
    subtotal: toDollars(subtotalCents),
    taxableSubtotal: toDollars(taxableCents),
    nonTaxableSubtotal: toDollars(nonTaxableCents),
    discount: toDollars(discountCents),
    taxableBase: toDollars(taxableBaseCents),
    taxRatePercent: ratePercent,
    tax: toDollars(taxCents),
    total: toDollars(totalCents),
    amountPaid: toDollars(paidCents),
    balanceDue: toDollars(totalCents - paidCents),
  };
}

/**
 * The percent a catalog rate actually charges. A group rate (e.g. GST + PST)
 * is the sum of its active, non-group components; unknown ids are ignored.
 */
export function effectiveTaxRatePercent(rate: TaxRate, all: TaxRate[]): number {
  if (!rate.isGroup) return safe(rate.ratePercent);
  const byId = new Map(all.map((r) => [r.id, r]));
  const cents = rate.componentIds.reduce((sum, id) => {
    const c = byId.get(id);
    return c && c.active && !c.isGroup ? sum + Math.round(safe(c.ratePercent) * 1000) : sum;
  }, 0);
  return cents / 1000;
}
