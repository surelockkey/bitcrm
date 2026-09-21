import type { BusinessProfile } from './business-profile.entity';
import type { EstimateStatus } from './estimate.entity';
import type { InvoiceStatus } from './invoice.entity';

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
  /** The job's company, when it differs between documents. */
  companyName?: string;
}

/** GET /api/billing/public/portal/:token */
export interface PortalView {
  business: Pick<BusinessProfile, 'name' | 'phone' | 'email' | 'website' | 'address'> & { logoUrl?: string };
  client: { firstName: string; lastName: string };
  estimates: PortalDocumentSummary[];
  invoices: PortalDocumentSummary[];
  preview: boolean;
}
