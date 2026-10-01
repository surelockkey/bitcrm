import type { PaymentTerms } from '../enums/payment-terms.enum';
import type { DocumentDiscount, DocumentTaxSource, DocumentTotals } from '../billing/totals';
import type { ProductType } from '../enums/product-type.enum';
import type { DocumentSignatureView } from './document-signature.entity';
import type { OnlinePaymentMethod, Payment, PaymentSummary } from './payment.entity';

/**
 * Derived, never set by hand (Workiz):
 * - `no_amount` — total is 0 (no billable items)
 * - `due`       — unpaid, due date not passed
 * - `overdue`   — unpaid, due date passed
 * - `paid`      — balance fully collected
 */
export const INVOICE_STATUSES = ['no_amount', 'due', 'overdue', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * A line of a CLIENT invoice (one with no job). A job invoice has no rows of
 * its own — its lines are the job's items.
 */
export interface InvoiceItem {
  lineId: string;
  invoiceId: string;
  /** Sort position (0-based). */
  position: number;
  productId: string;
  productType?: ProductType;
  name: string;
  sku: string;
  description?: string;
  quantity: number;
  priceClient: number;
  costCompany: number;
  costForTech: number;
  taxable: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * An invoice belongs to a JOB or to a CLIENT alone (Workiz: "either a job or a
 * client"; the client card's Create new → Invoice makes one without a job).
 *
 * - Job invoice: exactly one per job; `id` === `dealId`, `number` === the job's
 *   number. It owns no item rows — its items, tax rate, taxable flags and
 *   discount ARE the job's (two-way sync by construction).
 * - Client invoice: no `dealId`; `id` a fresh uuid, `number` from the
 *   account-wide document counter (shared with client estimates). It owns its
 *   `InvoiceItem` rows and its own tax/discount snapshot (the fields below),
 *   and its due date comes from the CLIENT's payment terms.
 */
export interface Invoice {
  /** === dealId on a job invoice; a uuid on a client invoice. */
  id: string;
  /** === deal.dealNumber on a job invoice; the account counter's number otherwise. */
  number: string;
  /** Absent on a client invoice (no job). */
  dealId?: string;
  contactId: string;
  companyId?: string;
  /* ---- own tax/discount snapshot: CLIENT invoices only (a job invoice reads the job's) */
  taxRateId?: string;
  taxRateName?: string;
  taxRatePercent?: number;
  taxSource?: DocumentTaxSource;
  discount?: DocumentDiscount;
  /** YYYY-MM-DD; defaults to the creation day, editable. */
  invoiceDate: string;
  paymentTerms: PaymentTerms;
  /** YYYY-MM-DD. Computed from the terms at creation; editable (custom). */
  dueDate: string;
  notes?: string;
  /** Explicit template; absent ⇒ auto-apply rules → default invoice template. */
  templateId?: string;
  /** Set by send/mark-sent. Unsent documents are hidden from the client portal. */
  sentAt?: string;
  sentBy?: string;
  /**
   * Workiz "Let client pay with" — the methods offered on THIS document,
   * chosen at send time. Absent ⇒ whatever the account settings allow.
   */
  allowedMethods?: OnlinePaymentMethod[];
  /**
   * Workiz "Request signature", chosen at send time: the portal asks the
   * client to sign before paying. Absent ⇒ the account default.
   */
  requestSignature?: boolean;
  status: InvoiceStatus;
  /** Last known totals (kept fresh from deal events) for list views. */
  totals: DocumentTotals;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;

  /* ------------------------------------------ carried over from Workiz */
  /** Workiz `invoice_name` — the Invoice Name column (rarely set). */
  workizName?: string;
  /** Workiz's own invoice serial. */
  workizNumber?: number;
  /** `workiz:invoice:<id>` on an imported invoice. */
  externalId?: string;
  /** Workiz's tip on the job (an imported invoice); BitCRM keeps tips on the payments. */
  tipAmount?: number;
}

/**
 * An invoice with its lines + tax — what the detail screen/PDF use. On a job
 * invoice the lines and tax are the job's, live; on a client invoice they are
 * its own rows (`position` set, in order).
 */
export interface InvoiceView extends Invoice {
  items: BillingLine[];
  /** The ledger behind `totals.amountPaid`, newest first. */
  payments?: Payment[];
  paymentSummary?: PaymentSummary;
  /** Every signature collected on it, oldest first (the document prints the latest). */
  signatures?: DocumentSignatureView[];
}

/** Common line shape rendered on invoices/estimates. */
export interface BillingLine {
  /** Estimate / client-invoice line id, or the productId for job lines. */
  lineId: string;
  /** Sort position of an owned row (client invoice); absent for job lines. */
  position?: number;
  productId: string;
  productType?: ProductType;
  name: string;
  sku: string;
  description?: string;
  quantity: number;
  priceClient: number;
  costCompany?: number;
  costForTech?: number;
  taxable: boolean;
  /** quantity × priceClient, rounded to cents. */
  amount: number;
}
