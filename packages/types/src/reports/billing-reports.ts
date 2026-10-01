import type { EstimateStatus } from '../entities/estimate.entity';
import type { Invoice, InvoiceStatus } from '../entities/invoice.entity';

/**
 * The billing reports of Workiz Reports, in BitCRM: Aging invoices, Tax, and
 * the Invoices / Estimates report pages. Days are the account's business days
 * (America/New_York, `DASHBOARD_TIMEZONE`), the clock Workiz reports on.
 *
 * Only shapes and the few rules both the server and the web need live here;
 * the arithmetic is the services' (`billing` for invoices and estimates,
 * `deal` for tax).
 */

/** A CSV export as the API hands it over (the same shape as the Payments report's). */
export interface ReportCsvExport {
  filename: string;
  csv: string;
  /** Data rows in `csv`. */
  count: number;
  /** The export stopped at its row cap; narrow the range for the rest. */
  truncated: boolean;
}

// ---------------------------------------------------------------- aging

/**
 * The five cards of Workiz's Aging invoices (`filter.timeline`): `all` is
 * EVERY unpaid invoice, due or not yet (Workiz "N invoices due", verified live
 * 2026-09-29: 547 = 295 overdue + 252 whose due date has not come); the four
 * others are the overdue ones by Days Late, `[1,30) [30,60) [60,90) [90,∞)`.
 */
export const AGING_BUCKETS = ['all', 'under30', 'from30to60', 'from60to90', 'over90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export type AgingOverdueBucket = Exclude<AgingBucket, 'all'>;

/** Workiz's card captions. */
export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  all: 'invoices due',
  under30: 'under 30 days',
  from30to60: '30-60 days',
  from60to90: '60-90 days',
  over90: 'over 90 days',
};

const DAY_MS = 86_400_000;
const ymdMs = (ymd: string): number => Date.parse(`${ymd.slice(0, 10)}T00:00:00.000Z`);

/**
 * Workiz `late_by`: whole days from the due date to `today`, never below 0 —
 * an invoice whose due date has not come is 0 days late, not −3.
 */
export function agingDaysLate(dueDate: string | undefined, today: string): number {
  if (!dueDate) return 0;
  const a = ymdMs(dueDate);
  const b = ymdMs(today);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/** The overdue card a Days Late value belongs to; `null` = not overdue yet (0). */
export function agingBucketOf(daysLate: number): AgingOverdueBucket | null {
  if (!(daysLate >= 1)) return null;
  if (daysLate < 30) return 'under30';
  if (daysLate < 60) return 'from30to60';
  if (daysLate < 90) return 'from60to90';
  return 'over90';
}

export interface ReportCard {
  count: number;
  amount: number;
}

/** One row of the Aging table — Workiz's eight columns plus the links. */
export interface AgingRow {
  invoiceId: string;
  /** Absent for a client invoice (no job). */
  dealId?: string;
  /** Invoice No. — the job's number, as in Workiz. */
  number: string;
  /** Invoice Name (Workiz `invoice_name`; usually empty). */
  name?: string;
  contactId: string;
  clientName?: string;
  /** Shown under the name, as Workiz does (email, else phone). */
  clientEmail?: string;
  clientPhone?: string;
  total: number;
  /** What is still owed. */
  balance: number;
  /** YYYY-MM-DD */
  dueDate: string;
  /** ISO UTC */
  createdAt: string;
  daysLate: number;
}

export const AGING_SORTS = ['number', 'name', 'client', 'total', 'balance', 'dueDate', 'createdAt', 'daysLate'] as const;
export type AgingSort = (typeof AGING_SORTS)[number];

export interface AgingReport {
  /** The business day Days Late is counted to. */
  asOf: string;
  bucket: AgingBucket;
  cards: Record<AgingBucket, ReportCard>;
  items: AgingRow[];
  /** Rows under `bucket` — "of N". */
  total: number;
  page: number;
  pageSize: number;
  /**
   * `false` until `backfill:unpaid-index` has run on this environment: the
   * answer then came from a full read of the invoice list (slow, still right).
   */
  indexReady: boolean;
}

// ------------------------------------------------------------- invoices

/** Workiz's "Status" filter group. `partially_paid` = something paid, something still owed. */
export const INVOICE_REPORT_STATUSES = ['paid', 'partially_paid', 'due', 'overdue'] as const;
export type InvoiceReportStatus = (typeof INVOICE_REPORT_STATUSES)[number];

/** Workiz's "Days due" filter group. */
export const INVOICE_DAYS_DUE = ['0_30', '30_60', '60_90', '90_120', 'over_120'] as const;
export type InvoiceDaysDue = (typeof INVOICE_DAYS_DUE)[number];

export const INVOICE_DAYS_DUE_LABELS: Record<InvoiceDaysDue, string> = {
  '0_30': '0-30 days',
  '30_60': '30-60 days',
  '60_90': '60-90 days',
  '90_120': '90-120 days',
  over_120: 'over 120 days',
};

const shiftYmd = (ymd: string, days: number): string =>
  new Date(ymdMs(ymd) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The due-date window of a "Days due" option, as Workiz sends it
 * (`daysDue[] = {from, to}`, both ends inclusive, counted back from today):
 * 0-30 → today−30 … today, 30-60 → today−60 … today−30, …, over 120 → up to
 * today−120. Neighbouring windows share their edge day, as in Workiz.
 */
export function invoiceDaysDueWindow(bucket: InvoiceDaysDue, today: string): { from?: string; to: string } {
  switch (bucket) {
    case '0_30':
      return { from: shiftYmd(today, -30), to: today };
    case '30_60':
      return { from: shiftYmd(today, -60), to: shiftYmd(today, -30) };
    case '60_90':
      return { from: shiftYmd(today, -90), to: shiftYmd(today, -60) };
    case '90_120':
      return { from: shiftYmd(today, -120), to: shiftYmd(today, -90) };
    case 'over_120':
    default:
      return { to: shiftYmd(today, -120) };
  }
}

/** The four cards over Workiz's Invoices list. */
export interface InvoiceReportSummary {
  /** The created-date window the first three cards are for (absent = All time). */
  from?: string;
  to?: string;
  /** Every unpaid invoice — due and overdue — created in the window (Workiz "Due from N invoices"). */
  due: ReportCard;
  /** Unpaid, due date before today. */
  overdue: ReportCard;
  /** Unpaid and never sent to the client. */
  unsent: { count: number };
  /** Jobs with items and no invoice — account-wide, not windowed (as in Workiz). */
  needInvoices: { count: number };
  indexReady: boolean;
}

/**
 * Workiz counts an invoice that owes no more than a cent as PAID: its lists
 * show $0.00 due and "Paid", and it is in no Aging bucket, although the
 * invoice itself still carries the cent (verified on 89 imported invoices).
 * The reports read the stored balance through this rule; the invoice is not
 * changed.
 */
export const INVOICE_PAID_TOLERANCE = 0.01;

/** What the reports show as due: the balance, or 0 when it is within a cent (or overpaid). */
export function reportInvoiceBalance(totals: { balanceDue?: number } | undefined): number {
  const b = totals?.balanceDue ?? 0;
  return b > INVOICE_PAID_TOLERANCE ? b : 0;
}

/** Still owes money as the reports count it (Workiz `job_amount_due > $0.01`). */
export function isReportOpen(inv: { status: string; totals?: { balanceDue?: number } }): boolean {
  return (inv.status === 'due' || inv.status === 'overdue') && reportInvoiceBalance(inv.totals) > 0;
}

/** The status the reports show: an open invoice owing ≤ $0.01 reads as Paid. */
export function reportInvoiceStatus(inv: { status: InvoiceStatus; totals?: { balanceDue?: number } }): InvoiceStatus {
  if ((inv.status === 'due' || inv.status === 'overdue') && !isReportOpen(inv)) return 'paid';
  return inv.status;
}

/**
 * An invoice's money the way Workiz's Invoices report prints it. BitCRM keeps
 * the card service fee as a line of the job (so it is in `totals.subtotal`)
 * and the tip on the payments (so it is NOT in `totals.total`); Workiz shows
 * Subtotal without the fee and Amount with the tip. Stored totals are left as
 * they are — this is the report's arithmetic only.
 */
export interface InvoiceReportFigures {
  /** Workiz Subtotal: `totals.subtotal − serviceFee`. */
  subtotal: number;
  tax: number;
  /** Workiz Amount: `totals.total + tip`. */
  amount: number;
  /** Workiz Due: the balance, 0 within a cent. */
  balance: number;
  status: InvoiceStatus;
  tip: number;
  serviceFee: number;
}

const cents2 = (n: number): number => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;

export function invoiceReportFigures(
  inv: Pick<Invoice, 'status' | 'totals'>,
  extra: { tip?: number; serviceFee?: number } = {},
): InvoiceReportFigures {
  const t = inv.totals;
  const tip = extra.tip ?? 0;
  const serviceFee = extra.serviceFee ?? 0;
  return {
    subtotal: cents2((t?.subtotal ?? 0) - serviceFee),
    tax: t?.tax ?? 0,
    amount: cents2((t?.total ?? 0) + tip),
    balance: reportInvoiceBalance(t),
    status: reportInvoiceStatus(inv),
    tip,
    serviceFee,
  };
}

/** A row of the Invoices report list: the invoice plus its report figures. */
export type InvoiceReportRow = Invoice & { report: InvoiceReportFigures };

/** Workiz's Discount column: the discount as a percent of the subtotal, two places. */
export function invoiceDiscountPercent(totals: { subtotal?: number; discount?: number } | undefined): number {
  const sub = totals?.subtotal ?? 0;
  const disc = totals?.discount ?? 0;
  if (!(sub > 0) || !(disc > 0)) return 0;
  return Math.round((disc / sub) * 10_000) / 100;
}

// ------------------------------------------------------------ estimates

/** Workiz's card and select labels, in Workiz's order. */
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  unsent: 'Unsent',
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  won: 'Won',
  archived: 'Archived',
};

/** The six status cards — "N Worth $X" — plus their sum. */
export type EstimateReportSummary = Record<EstimateStatus, ReportCard> & {
  total: ReportCard;
  from?: string;
  to?: string;
};

/**
 * What an estimate is worth in the report (Workiz's Amount). An imported
 * estimate carries Workiz's own figure (`workizTotal`), which leaves out the
 * optional items the client did not pick — BitCRM has no optional items yet,
 * so its `totals.total` counts them. The Workiz figure stands until the
 * estimate is re-priced here (the service then drops it).
 */
export function estimateReportAmount(e: { totals?: { total?: number }; workizTotal?: number }): number {
  if (typeof e.workizTotal === 'number' && Number.isFinite(e.workizTotal)) return e.workizTotal;
  return e.totals?.total ?? 0;
}

/** Workiz's Deposit due: a fixed deposit, else a percent of the amount. */
export function estimateDepositDue(e: {
  totals?: { total?: number };
  workizTotal?: number;
  depositAmount?: number;
  depositPercentage?: number;
}): number {
  if (typeof e.depositAmount === 'number' && e.depositAmount > 0) return e.depositAmount;
  const pct = e.depositPercentage ?? 0;
  if (!(pct > 0)) return 0;
  return Math.round(estimateReportAmount(e) * pct) / 100;
}

// ------------------------------------------------------------------ tax

/** Accrual = tax on what was sold; Paid = tax on what was collected. */
export const TAX_REPORT_BASES = ['accrual', 'paid'] as const;
export type TaxReportBasis = (typeof TAX_REPORT_BASES)[number];

/**
 * Accrual's "By:" — Workiz `report_by` 1 (Job created), 2 (Job date),
 * 3 (Job end date, this account's default). Paid always windows on the
 * payment date.
 */
export const TAX_REPORT_BY = ['created', 'scheduled', 'end'] as const;
export type TaxReportBy = (typeof TAX_REPORT_BY)[number];

export const TAX_REPORT_BY_LABELS: Record<TaxReportBy, string> = {
  created: 'Job created',
  scheduled: 'Job date',
  end: 'Job end date',
};

/** One row = one tax rate (name + percent) the jobs carried. */
export interface TaxReportRow {
  /** `<name>|<percent>` — the "Tax to show" value. */
  key: string;
  name: string;
  description: string;
  /** Rounded to two places, as Workiz prints it (8.875 → 8.88). */
  rate: number;
  /** The rate as the jobs carry it. */
  ratePercent: number;
  /** Accrual: tax on the jobs; Paid: the collected share of it (Workiz "Tax"). */
  amount: number;
  taxableAmount: number;
  /** Accrual only: subtotal − taxable amount; negative when a discount outweighs the untaxed lines. */
  nonTaxableAmount?: number;
  jobs: number;
}

export interface TaxReport {
  basis: TaxReportBasis;
  /** Accrual only. */
  by?: TaxReportBy;
  from: string;
  to: string;
  rows: TaxReportRow[];
  /** Workiz's KPI: Σ amount over the rows shown. */
  totalAmount: number;
  /** Every rate the window's jobs carried — the "Tax to show" options. */
  taxes: Array<{ key: string; name: string; rate: number }>;
}

/** `<name>|<percent>` — how a row is keyed and filtered. */
export function taxRateKey(name: string | undefined, percent: number | undefined): string {
  return `${(name ?? '').trim()}|${Number(percent ?? 0)}`;
}

/** Workiz prints the rate with two places. */
export function taxRateRounded(percent: number | undefined): number {
  return Math.round(Number(percent ?? 0) * 100) / 100;
}
