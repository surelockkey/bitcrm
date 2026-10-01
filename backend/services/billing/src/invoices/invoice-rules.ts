import {
  PaymentTerms,
  calculateDocumentTotals,
  type BusinessProfile,
  type Deal,
  type DealProduct,
  type DocumentTotals,
  type Invoice,
  type InvoiceItem,
  type InvoiceStatus,
} from '@bitcrm/types';
import { addDays, dateIn, isYmd } from '../common/dates';

/**
 * Pure invoice rules (Workiz model): terms → due date, job → totals,
 * totals + due date → derived status. No I/O here — the service feeds it.
 */

export interface TermsSource {
  paymentTerms?: PaymentTerms | string;
  customTermsDays?: number;
}

const FIXED_DAYS: Record<string, number> = {
  [PaymentTerms.CASH]: 0,
  [PaymentTerms.NET_15]: 15,
  [PaymentTerms.NET_30]: 30,
  [PaymentTerms.NET_60]: 60,
};

const isTerms = (v: unknown): v is PaymentTerms =>
  typeof v === 'string' && (Object.values(PaymentTerms) as string[]).includes(v);

export function termDays(terms: PaymentTerms, customDays?: number): number {
  if (terms === PaymentTerms.CUSTOM) {
    return Number.isFinite(customDays) && (customDays as number) > 0 ? Math.floor(customDays as number) : 0;
  }
  return FIXED_DAYS[terms] ?? 0;
}

/** Contact terms → company terms → business-profile default. */
export function resolvePaymentTerms(
  contact: TermsSource | null | undefined,
  company: TermsSource | null | undefined,
  profile: BusinessProfile,
): { terms: PaymentTerms; days: number } {
  for (const src of [contact, company]) {
    if (src && isTerms(src.paymentTerms)) {
      const custom = src.customTermsDays ?? profile.defaultCustomTermDays;
      return { terms: src.paymentTerms, days: termDays(src.paymentTerms, custom) };
    }
  }
  const terms = isTerms(profile.defaultPaymentTerms) ? profile.defaultPaymentTerms : PaymentTerms.CASH;
  return { terms, days: termDays(terms, profile.defaultCustomTermDays) };
}

export function paymentTermsLabel(terms: PaymentTerms | string | undefined, days?: number): string {
  switch (terms) {
    case PaymentTerms.CASH:
      return 'Due on receipt';
    case PaymentTerms.NET_15:
      return 'Net 15';
    case PaymentTerms.NET_30:
      return 'Net 30';
    case PaymentTerms.NET_60:
      return 'Net 60';
    case PaymentTerms.CUSTOM:
      return days && days > 0 ? `Net ${days}` : 'Custom';
    default:
      return '';
  }
}

/** The day the terms are counted from, per `profile.dueDateBasis`. */
export function dueDateBasisDate(
  profile: BusinessProfile,
  input: { invoiceDate: string; deal: Pick<Deal, 'createdAt' | 'scheduledDate'>; timezone: string },
): string {
  switch (profile.dueDateBasis) {
    case 'job_created':
      return input.deal.createdAt ? dateIn(input.deal.createdAt, input.timezone) : input.invoiceDate;
    case 'job_scheduled':
      return isYmd(input.deal.scheduledDate) ? input.deal.scheduledDate : input.invoiceDate;
    case 'invoice_created':
    default:
      return input.invoiceDate;
  }
}

export function computeDueDate(basis: string, days: number): string {
  return addDays(basis, days);
}

/**
 * The invoice's totals are the job's: its lines, snapshotted tax percent and
 * discount.
 *
 * `opts.amountPaid` is the PAYMENT LEDGER's answer (billing owns it, see
 * `payments/payment-rules.ts`) and wins outright — including when it is 0,
 * which is how a reversal pushes a paid invoice back to `due`. Only when no
 * ledger row exists at all does the pre-ledger behaviour apply: a job the
 * payment flow marked `paid` counts `actualTotal` (or the whole total) as
 * collected.
 */
export function computeInvoiceTotals(
  view: {
    deal: Pick<Deal, 'taxRatePercent' | 'taxSource' | 'discount' | 'paymentStatus' | 'actualTotal'>;
    items: Pick<DealProduct, 'quantity' | 'priceClient' | 'taxable' | 'discountable'>[];
  },
  opts: { amountPaid?: number } = {},
): DocumentTotals {
  const { deal } = view;
  const base = {
    lines: view.items.map((i) => ({
      quantity: i.quantity,
      priceClient: i.priceClient,
      taxable: i.taxable,
      discountable: i.discountable,
    })),
    taxRatePercent: deal.taxSource === 'exempt' ? 0 : deal.taxRatePercent ?? 0,
    discount: deal.discount ?? undefined,
  };
  if (typeof opts.amountPaid === 'number') {
    return calculateDocumentTotals({ ...base, amountPaid: opts.amountPaid });
  }
  const unpaid = calculateDocumentTotals(base);
  if (deal.paymentStatus !== 'paid') return unpaid;
  const paid = typeof deal.actualTotal === 'number' ? deal.actualTotal : unpaid.total;
  return calculateDocumentTotals({ ...base, amountPaid: paid });
}

/**
 * A CLIENT invoice's totals: its own rows, its own tax percent (none when the
 * client is exempt) and discount. `amountPaid` is the ledger's answer; with
 * no ledger row nothing has been paid — there is no job whose payment flag
 * could say otherwise.
 */
export function computeClientInvoiceTotals(
  invoice: Pick<Invoice, 'taxRatePercent' | 'taxSource' | 'discount'>,
  items: Pick<InvoiceItem, 'quantity' | 'priceClient' | 'taxable'>[],
  opts: { amountPaid: number },
): DocumentTotals {
  return calculateDocumentTotals({
    lines: items.map((i) => ({ quantity: i.quantity, priceClient: i.priceClient, taxable: i.taxable })),
    taxRatePercent: invoice.taxSource === 'exempt' ? 0 : invoice.taxRatePercent ?? 0,
    discount: invoice.discount ?? undefined,
    amountPaid: opts.amountPaid,
  });
}

export function deriveInvoiceStatus(input: {
  totals: Pick<DocumentTotals, 'total' | 'balanceDue'>;
  dueDate: string;
  today: string;
  paymentStatus?: string;
}): InvoiceStatus {
  if (input.paymentStatus === 'paid') return 'paid';
  if (!(input.totals.total > 0)) return 'no_amount';
  if (input.totals.balanceDue <= 0) return 'paid';
  return input.dueDate < input.today ? 'overdue' : 'due';
}
