import type { Address } from './address.entity';
import { PaymentTerms } from '../enums/payment-terms.enum';

/**
 * One of the business's companies (brands) — how it appears on documents and
 * the client portal. Jobs pick one (`Deal.businessProfileId`); exactly one is
 * the default.
 */
export interface BusinessProfile {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  legalName?: string;
  phone?: string;
  email?: string;
  website?: string;
  licenseNumber?: string;
  address?: Address;
  /** Billing asset id of the uploaded logo. */
  logoAssetId?: string;
  /** Default payment terms for new invoices when the client has none. */
  defaultPaymentTerms: PaymentTerms;
  /** Days, used when defaultPaymentTerms === custom. */
  defaultCustomTermDays?: number;
  /** When a job invoice's due date is counted from. */
  dueDateBasis: 'invoice_created' | 'job_created' | 'job_scheduled';
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

/** A company as returned by the API: the logo resolved to a short-lived URL. */
export interface BusinessProfileView extends BusinessProfile {
  logoUrl?: string;
}

export const DEFAULT_BUSINESS_PROFILE_ID = 'bp-default';

export const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  id: DEFAULT_BUSINESS_PROFILE_ID,
  isDefault: true,
  active: true,
  name: 'Your Business',
  defaultPaymentTerms: PaymentTerms.CASH,
  dueDateBasis: 'invoice_created',
};

/** An uploaded image usable in document templates. */
export interface BillingAsset {
  id: string;
  contentType: string;
  fileName?: string;
  size?: number;
  createdBy: string;
  createdAt: string;
}
