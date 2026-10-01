import type { DocumentDiscount, DocumentTaxSource, DocumentTotals } from '../billing/totals';
import type { ProductType } from '../enums/product-type.enum';
import type { DocumentSignatureView } from './document-signature.entity';
import type { DocumentVisibility } from './document-template.entity';

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

/**
 * An estimate belongs to a JOB or to a CLIENT alone (Workiz: "either a job or
 * a client"; the client card's Create new → Estimate makes one without a job).
 *
 * - On a job: many per job, number `<dealNumber>-<n>` (n is never reused),
 *   `dealId`/`dealNumber` set, tax/discount start as the job's.
 * - On a client only: no `dealId`/`dealNumber`, number from the account-wide
 *   document counter (Workiz's "stub" — 1141), office-only (a technician's
 *   `assigned_only` scope has no job to be assigned to), and Sync to job is
 *   refused until the estimate has a job.
 */
export interface Estimate {
  id: string;
  number: string;
  /** Absent on a client estimate (no job). */
  dealId?: string;
  /** Absent on a client estimate (no job). */
  dealNumber?: string;
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
  /** Workiz "Advanced: choose the details your client sees" — per-document overrides of the template's visibility. */
  display?: Partial<DocumentVisibility>;
  sentAt?: string;
  sentBy?: string;
  /** The sales proposal this estimate went out in, if any (Workiz `proposal_id`). */
  proposalId?: string;
  approvedAt?: string;
  /** `portal` when the client signed it on the client portal; `staff` when set by hand. */
  approvedVia?: 'portal' | 'staff';
  /** When the latest signature was collected (portal or in person). */
  signedAt?: string;
  declinedAt?: string;
  wonAt?: string;
  syncedAt?: string;
  syncedBy?: string;
  totals: DocumentTotals;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;

  /* ------------------------------------------ carried over from Workiz */
  /**
   * Workiz's own Amount (`job_total_price`) for an imported estimate — it
   * leaves out unpicked optional items, which BitCRM does not model yet. Kept
   * until the estimate is re-priced here; the reports prefer it
   * (`estimateReportAmount`).
   */
  workizTotal?: number;
  /** The Workiz number (`<job serial>-<n>`), the same as `number` on import. */
  workizNumber?: string;
  /** Who created it, as Workiz named them (the report's "Created By"). */
  createdByName?: string;
  /** Workiz deposit: a fixed amount, or a percent of the total. */
  depositAmount?: number;
  depositPercentage?: number;
  declineReason?: string;
}

export interface EstimateWithItems extends Estimate {
  items: EstimateItem[];
  /** Every signature collected on it, oldest first (the document prints the latest). */
  signatures?: DocumentSignatureView[];
}
