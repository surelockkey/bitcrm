import type { PaymentTerms } from '../enums/payment-terms.enum';
import type { DocumentDiscount, DocumentTaxSource, DocumentTotals } from '../billing/totals';

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
 * A job invoice. Exactly one per job; its id and number are the job's. The
 * invoice owns no item rows — its items, tax rate, taxable flags and discount
 * ARE the job's (two-way sync by construction).
 */
export interface Invoice {
  /** === dealId */
  id: string;
  /** === deal.dealNumber */
  number: string;
  dealId: string;
  contactId: string;
  companyId?: string;
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
  status: InvoiceStatus;
  /** Last known totals (kept fresh from deal events) for list views. */
  totals: DocumentTotals;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** An invoice with the job's live lines + tax — what the detail screen/PDF use. */
export interface InvoiceView extends Invoice {
  items: BillingLine[];
  taxRateId?: string;
  taxRateName?: string;
  taxRatePercent?: number;
  taxSource?: DocumentTaxSource;
  discount?: DocumentDiscount;
}

/** Common line shape rendered on invoices/estimates. */
export interface BillingLine {
  /** Estimate line id, or the productId for job lines. */
  lineId: string;
  productId: string;
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
