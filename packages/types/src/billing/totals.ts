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
  /**
   * Absent ⇒ the document discount reaches this line. Workiz keeps its card
   * service fee and lines marked non-discountable out of the discount, and
   * out of the amount a percent discount is taken of.
   */
  discountable?: boolean;
}

export interface DocumentTotals {
  lineCount: number;
  subtotal: number;
  taxableSubtotal: number;
  nonTaxableSubtotal: number;
  /** What the discount takes off the total: subtotal − discount + tax = total, to the cent. */
  discount: number;
  /**
   * Taxable subtotal minus its proportional share of the discount, rounded
   * for display — the tax is taken from the unrounded amount.
   */
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

/**
 * Dollars → whole cents the way Workiz rounds money (PHP `round($x, 2)`):
 * half away from zero, on the decimal value. Binary floats carry noise past
 * the 15th significant digit — 410 × 6.35% is 26.034999999999997, which a bare
 * `Math.round(x * 100)` takes to 26.03 where Workiz (and a calculator) say
 * 26.04 — so that noise is dropped before rounding.
 */
const toCents = (dollars: number): number => {
  const scaled = Number((dollars * 100).toPrecision(15));
  const cents = Math.round(Math.abs(scaled));
  return scaled < 0 && cents !== 0 ? -cents : cents;
};
const toDollars = (cents: number): number => Math.round(cents) / 100;
const safe = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Line amount (quantity × price) rounded to cents, in dollars. */
export function lineAmount(line: Pick<TotalsLine, 'quantity' | 'priceClient'>): number {
  return toDollars(toCents(safe(line.quantity) * safe(line.priceClient)));
}

/**
 * The single totals formula shared by the API, the web app and the PDF
 * renderer. It is Workiz's own, so imported jobs and invoices total to the
 * cent what Workiz billed (checked against 77 884 of 77 887 Workiz invoices
 * and 116 351 of 116 354 done jobs that have lines; the rest are documents
 * whose stored lines no longer add up in Workiz itself):
 *
 * 1. A line is worth quantity × price, NOT rounded to cents: Workiz keeps
 *    prices such as 145.745, backed out of a tax-inclusive figure, and taxes
 *    the unrounded amount.
 * 2. The discount — an amount, or a percent of the discountable lines — is
 *    shared between the discountable taxable and non-taxable lines in
 *    proportion to their amounts.
 * 3. tax = rate × (taxable amount − its share of the discount), rounded to
 *    the cent once. A negative base (credit lines) owes no tax.
 * 4. total = (subtotal − discount) rounded to the cent, plus tax.
 *
 * Every rounding is `toCents`: half away from zero on the decimal value. The
 * subtotal is rounded on its own and the discount shown is what is left, so
 * subtotal − discount + tax = total always holds on the document.
 */
export function calculateDocumentTotals(input: TotalsInput): DocumentTotals {
  let subtotal = 0;
  let taxable = 0;
  let discountable = 0;
  let taxableDiscountable = 0;
  for (const line of input.lines) {
    const amount = safe(line.quantity) * safe(line.priceClient);
    const isTaxable = line.taxable !== false;
    const isDiscountable = line.discountable !== false;
    subtotal += amount;
    if (isTaxable) taxable += amount;
    if (isDiscountable) discountable += amount;
    if (isTaxable && isDiscountable) taxableDiscountable += amount;
  }

  let discount = 0;
  const d = input.discount;
  if (d && safe(d.value) > 0) {
    discount = d.type === 'percent' ? (discountable * Math.min(100, safe(d.value))) / 100 : safe(d.value);
  }
  discount = Math.max(0, Math.min(discount, discountable));

  const taxableShare = discountable > 0 ? (discount * taxableDiscountable) / discountable : 0;
  const taxableBase = taxable - taxableShare;

  const ratePercent = Math.max(0, safe(input.taxRatePercent));
  const taxCents = Math.max(0, toCents((taxableBase * ratePercent) / 100));

  const subtotalCents = toCents(subtotal);
  const taxableCents = toCents(taxable);
  const discountedCents = toCents(subtotal - discount);
  const totalCents = discountedCents + taxCents;
  const paidCents = toCents(Math.max(0, safe(input.amountPaid)));

  return {
    lineCount: input.lines.length,
    subtotal: toDollars(subtotalCents),
    taxableSubtotal: toDollars(taxableCents),
    nonTaxableSubtotal: toDollars(subtotalCents - taxableCents),
    discount: toDollars(subtotalCents - discountedCents),
    taxableBase: toDollars(toCents(taxableBase)),
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
