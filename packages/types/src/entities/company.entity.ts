import { ClientType } from '../enums/client-type.enum';
import { CrmStatus } from '../enums/crm-status.enum';
import { PaymentTerms } from '../enums/payment-terms.enum';

export interface Company {
  id: string;
  title: string;
  phones: string[];
  /**
   * Set only when the viewer lacks `contacts.view_numbers`: `phones` comes back
   * empty and this says how many were withheld, so the UI can render
   * "2 numbers, hidden" rather than the "—" that means genuinely none.
   */
  phoneCount?: number;
  phonesMasked?: true;
  /**
   * What to press once the call is answered — `{ '+14045551234': '102' }`.
   * Keyed by the number it belongs to rather than sitting in the number
   * itself, so the phone stays dialable and the call log keeps matching it.
   */
  phoneExtensions?: Record<string, string>;
  emails: string[];
  address?: string;
  website?: string;
  clientType: ClientType;
  notes?: string;
  status: CrmStatus;

  // --- Platinum client financial terms & compliance (EPIC-9) ---
  /** Marks a VIP/platinum client; independent of clientType. */
  isPlatinum?: boolean;
  paymentTerms?: PaymentTerms;
  /** Days for PaymentTerms.CUSTOM. */
  customTermsDays?: number;
  taxExempt?: boolean;
  /** Whether a PO number is required on this client's deals. */
  poRequired?: boolean;
  /** COI expiry "YYYY-MM-DD"; status is derived in the UI. */
  coiExpiration?: string;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
