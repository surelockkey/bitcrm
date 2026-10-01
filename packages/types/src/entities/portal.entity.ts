import type { BusinessProfile } from './business-profile.entity';
import type { EstimateStatus } from './estimate.entity';
import type { InvoiceStatus } from './invoice.entity';
import type { PaymentMethod, PaymentStatus } from './payment.entity';
import type { PortalProposalSummary } from './proposal.entity';

/** Metadata of a client's portal link (the raw token is only returned on create). */
export interface PortalLink {
  contactId: string;
  /** Full URL, only present right after creation/regeneration. */
  url?: string;
  token?: string;
  /** Set on `POST …/url` when an older, unrecoverable link had to be replaced by a new one. */
  replaced?: boolean;
  createdBy: string;
  createdAt: string;
  lastViewedAt?: string;
}

export interface PortalDocumentSummary {
  kind: 'invoice' | 'estimate';
  id: string;
  number: string;
  date: string;
  status: InvoiceStatus | EstimateStatus;
  total: number;
  balanceDue?: number;
  dueDate?: string;
  name?: string;
  sent: boolean;
  /** Estimate: the proposal it is an option of. */
  proposalId?: string;
  /** The job's company, when it differs between documents. */
  companyName?: string;
  /** True when this document can be paid online right now. */
  payable?: boolean;
  /** Taken but still clearing (ACH) — shown as a note, not deducted. */
  amountPending?: number;
  /**
   * Estimate: still open, so approving it means signing it (Workiz: every
   * estimate needs a signature to approve). Invoice: "Request signature" was
   * chosen at send time and nobody has signed yet.
   */
  signatureNeeded?: boolean;
  /** At least one signature was collected on it. */
  signed?: boolean;
  /** Estimate: the deposit asked for (Workiz "Required deposit"), when one is set. */
  depositDue?: number;
  /** Estimate: deposit money already settled on it. */
  depositPaid?: number;
}

/** One of the client's jobs on the portal's My Booking tab (Workiz: Upcoming = submitted + future, Completed = done). */
export interface PortalJob {
  id: string;
  number: string;
  kind: 'upcoming' | 'completed';
  scheduledDate?: string;
  scheduledEndDate?: string;
  /** IANA zone of the job, for the "Add to calendar" link. */
  timezone?: string;
  jobType?: string;
  /** One line. */
  address?: string;
  technicians: string[];
}

/** One line of the client's payment history on the portal (never a card number). */
export interface PortalPaymentLine {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  takenAt: string;
  invoiceId?: string;
  /** Set when the payment was an estimate's deposit. */
  estimateId?: string;
  cardBrand?: string;
  last4?: string;
}

/** GET /api/billing/public/portal/:token */
export interface PortalView {
  business: Pick<BusinessProfile, 'name' | 'phone' | 'email' | 'website' | 'address' | 'description' | 'bookingUrl'> & {
    logoUrl?: string;
  };
  client: { firstName: string; lastName: string; email?: string; phone?: string };
  estimates: PortalDocumentSummary[];
  invoices: PortalDocumentSummary[];
  /** Sales proposals (good / better / best); their options are also in `estimates`. */
  proposals: PortalProposalSummary[];
  /** Upcoming first (soonest first), then completed (latest first). */
  jobs: PortalJob[];
  /** Newest first; failed attempts are left out. */
  payments: PortalPaymentLine[];
  preview: boolean;
}
