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
  isPlatinum?: boolean;
  paymentTerms?: PaymentTerms;
  customTermsDays?: number;
  taxExempt?: boolean;
  poRequired?: boolean;
  coiExpiration?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
