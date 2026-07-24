import { ClientType } from '../enums/client-type.enum';
import { CrmStatus } from '../enums/crm-status.enum';
import { PaymentTerms } from '../enums/payment-terms.enum';

export interface Company {
  id: string;
  title: string;
  phones: string[];
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
