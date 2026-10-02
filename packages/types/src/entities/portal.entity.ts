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
  /** Estimate: the option's pitch and cover image (Workiz good / better / best). */
  description?: string;
  coverUrl?: string;
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
  /**
   * The inbox is paged: `invoices`, `estimates` and `proposals` above hold its
   * first page only (a proposal brings its options along). Absent from an
   * older API, which sent everything at once.
   */
  inbox?: PortalInboxMeta;
}

/** Workiz "Inbox Display": which documents the inbox lists. Paid / Unpaid narrow the invoices. */
export type PortalInboxShow = 'invoices' | 'estimates' | 'paid' | 'unpaid';
export const PORTAL_INBOX_SHOW: readonly PortalInboxShow[] = ['invoices', 'estimates', 'paid', 'unpaid'];

/** How many inbox entries the filter selects, and where the next page starts. */
export interface PortalInboxMeta {
  /** Entries in the whole inbox under the current filter (a proposal counts once). */
  total: number;
  /** Opaque; absent on the last page. */
  nextCursor?: string;
}

/** GET …/portal/:token/inbox — one more page of the inbox. */
export interface PortalInboxPage {
  invoices: PortalDocumentSummary[];
  estimates: PortalDocumentSummary[];
  proposals: PortalProposalSummary[];
  inbox: PortalInboxMeta;
}

/** Where an inbox entry sorts: its date (a document's date, a proposal's `sentAt`), then `<kind>:<id>`. */
export interface PortalInboxKey {
  at: string;
  ref: string;
}

/**
 * The inbox order — newest first, ties broken by `ref` — shared by the
 * server that pages it and the portal that lists the pages, so an entry can
 * never jump between pages or out of place.
 */
export function portalInboxCompare(a: PortalInboxKey, b: PortalInboxKey): number {
  return b.at.localeCompare(a.at) || b.ref.localeCompare(a.ref);
}
