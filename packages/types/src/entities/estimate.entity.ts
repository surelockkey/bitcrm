import type { DocumentDiscount, DocumentTaxSource, DocumentTotals } from '../billing/totals';
import type { ProductType } from '../enums/product-type.enum';

/**
 * Workiz estimate statuses. `pending` is set on send, `won` on sync-to-job,
 * `archived` when the job is canceled; all may also be set by hand.
 */
export const ESTIMATE_STATUSES = ['unsent', 'pending', 'approved', 'declined', 'won', 'archived'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export interface EstimateItem {
  lineId: string;
  estimateId: string;
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

/** Many per job. Number = `<dealNumber>-<n>`; n is never reused. */
export interface Estimate {
  id: string;
  number: string;
  dealId: string;
  dealNumber: string;
  contactId: string;
  companyId?: string;
  /** Optional title, e.g. "Good" / "Rekey all locks". */
  name?: string;
  status: EstimateStatus;
  statusChangedAt?: string;
  /** YYYY-MM-DD */
  estimateDate: string;
  taxRateId?: string;
  taxRateName?: string;
  taxRatePercent?: number;
  taxSource?: DocumentTaxSource;
  discount?: DocumentDiscount;
  notes?: string;
  templateId?: string;
  sentAt?: string;
  sentBy?: string;
  approvedAt?: string;
  declinedAt?: string;
  wonAt?: string;
  syncedAt?: string;
  syncedBy?: string;
  totals: DocumentTotals;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateWithItems extends Estimate {
  items: EstimateItem[];
}
