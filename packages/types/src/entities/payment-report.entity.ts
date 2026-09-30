/**
 * The Payments report (Workiz Reports → Payments, `/root/payments`).
 *
 * One LINE per money movement, as Workiz lists them: every payment on its
 * payment date, and every refund as a line of its own, NEGATIVE, on the date
 * it was given back. The original payment keeps its full amount, so "Total
 * amount" is already net of refunds — exactly Workiz's arithmetic.
 *
 * Amounts include the tip. Workiz's `amount` contains the tip (verified on
 * 5,509 jobs); our ledger keeps `amount` without it and `tipAmount` beside
 * it, so a line's amount is `amount + tipAmount`, and "Total tips" is the
 * tips' share of "Total amount".
 */

/** Workiz payment types (the `payment_type` filter values) plus our `other`. */
export const PAYMENT_REPORT_TYPES = [
  'charge',
  'interac',
  'credit',
  'check_deposit',
  'check',
  'cash',
  'bank_transfer_offline',
  'cash_app',
  'consumer_financing',
  'venmo',
  'zelle',
  'debit_offline',
  'bank_transfer',
  'installments',
  'refund',
  'refund_offline',
  'payout',
  'dispute',
  'dispute_won',
  'other',
] as const;
export type PaymentReportType = (typeof PAYMENT_REPORT_TYPES)[number];

/** Workiz's labels for the Type column. */
export const PAYMENT_REPORT_TYPE_LABELS: Record<PaymentReportType, string> = {
  charge: 'Credit charge',
  interac: 'Interac',
  credit: 'Credit offline',
  check_deposit: 'Check deposit',
  check: 'Check',
  cash: 'Cash',
  bank_transfer_offline: 'Bank transfer (offline)',
  cash_app: 'Cash app',
  consumer_financing: 'Consumer financing',
  venmo: 'Venmo',
  zelle: 'Zelle',
  debit_offline: 'Debit offline',
  bank_transfer: 'Bank transfer (ACH)',
  installments: 'Installments',
  refund: 'Refund',
  refund_offline: 'Refund offline',
  payout: 'Instant payout fee',
  dispute: 'Dispute',
  dispute_won: 'Dispute won',
  other: 'Other',
};

/** A type we do not know (a future Workiz value) still gets a readable label. */
export function paymentReportTypeLabel(type: string | undefined): string {
  if (!type) return '';
  return (
    (PAYMENT_REPORT_TYPE_LABELS as Record<string, string>)[type] ??
    type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

/**
 * The "Payment type" group of Workiz's "Filter results", in Workiz's order
 * (US account: no Interac). Choosing Refund selects `refund` AND
 * `refund_offline`, as Workiz does. `other` is ours (a payment recorded here
 * as "other"); Workiz has no such type.
 */
export const PAYMENT_REPORT_TYPE_FILTERS: { value: string; label: string; types: PaymentReportType[] }[] = [
  { value: 'charge', label: 'Credit charge', types: ['charge'] },
  { value: 'credit', label: 'Credit offline', types: ['credit'] },
  { value: 'check_deposit', label: 'Check deposit', types: ['check_deposit'] },
  { value: 'check', label: 'Check', types: ['check'] },
  { value: 'cash', label: 'Cash', types: ['cash'] },
  { value: 'bank_transfer_offline', label: 'Bank transfer (offline)', types: ['bank_transfer_offline'] },
  { value: 'cash_app', label: 'Cash app', types: ['cash_app'] },
  { value: 'consumer_financing', label: 'Consumer financing', types: ['consumer_financing'] },
  { value: 'venmo', label: 'Venmo', types: ['venmo'] },
  { value: 'zelle', label: 'Zelle', types: ['zelle'] },
  { value: 'debit_offline', label: 'Debit offline', types: ['debit_offline'] },
  { value: 'bank_transfer', label: 'Bank transfer (ACH)', types: ['bank_transfer'] },
  { value: 'installments', label: 'Installments', types: ['installments'] },
  { value: 'refund', label: 'Refund', types: ['refund', 'refund_offline'] },
  { value: 'other', label: 'Other', types: ['other'] },
];

/**
 * Types that went through a payment processor. Workiz shows the Status tag
 * (Succeeded / Pending / Failed) ONLY for these; an offline line has none.
 */
export const PAYMENT_REPORT_ELECTRONIC_TYPES: readonly string[] = [
  'charge',
  'payout',
  'bank_transfer',
  'refund',
  'interac',
  'check_deposit',
];

/** The Status tag. `reversed` is ours (an ACH return / lost dispute). */
export type PaymentReportStatus = 'succeeded' | 'pending' | 'failed' | 'reversed';

/** One line of the report — Workiz's 14 columns plus what the CSV adds. */
export interface PaymentReportRow {
  /** The payment id, or the refund id for a refund line. */
  id: string;
  kind: 'payment' | 'refund';
  paymentId: string;
  refundId?: string;
  /** The job (Workiz shows "<number> (Job)" and links it). */
  dealId: string;
  dealNumber?: string;
  /** Payment date (the refund's date for a refund line), ISO UTC. */
  at: string;
  /** Signed dollars, tip included; a refund is negative; a failed payment is 0. */
  amount: number;
  /** Signed like `amount`. */
  tip: number;
  type: string;
  typeLabel: string;
  /** Only for electronic types (Workiz leaves the cell empty for offline ones). */
  status?: PaymentReportStatus;
  confirmationCode?: string;
  description?: string;
  contactId: string;
  clientName?: string;
  /** "XXXX1234", only for a Credit charge line. */
  card?: string;
  technicianId?: string;
  technicianName?: string;
  serviceAreaId?: string;
  transactionMethod?: string;
  collectedById?: string;
  collectedByName?: string;
  jobTypeId?: string;
  jobTypeName?: string;
  /** CSV only: the job's status ("Done", …). */
  jobStatus?: string;
  /** CSV "Service Fee": what the processor kept. */
  serviceFee?: number;
  /** CSV "Net": amount − service fee. */
  net?: number;
}

/** The two cards: "Total amount" and "Total tips", over the WHOLE filtered range. */
export interface PaymentReportTotals {
  /** Workiz's `counter`: every line in the range, the list's N. */
  count: number;
  amount: number;
  tips: number;
  /** Processor fees in the range (the CSV's Service Fee column, summed). */
  serviceFees: number;
  /** The same totals per Type — what the Type filter would show one by one. */
  byType: Record<string, { count: number; amount: number; tips: number }>;
}

export interface PaymentReportPage {
  items: PaymentReportRow[];
  nextCursor?: string;
  /** Only on the first page (no cursor) — the cards and "of N". */
  totals?: PaymentReportTotals;
}

/** The query both the list, the totals and the export take. */
export interface PaymentReportQuery {
  /** Business days (America/New_York), inclusive. Both absent = all time. */
  from?: string;
  to?: string;
  /** Filter-group values, OR within a group, AND between groups. */
  types?: string[];
  technicianIds?: string[];
  serviceAreaIds?: string[];
  /** Job number, confirmation code, card last 4, or an amount. */
  search?: string;
  /** Payment date order; Workiz's default is newest first. */
  dir?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}
