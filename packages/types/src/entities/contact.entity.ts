import { ContactType } from '../enums/contact-type.enum';
import { ContactSource } from '../enums/contact-source.enum';
import { CrmStatus } from '../enums/crm-status.enum';
import { Address } from './address.entity';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phones: string[];
  emails: string[];
  /** Structured postal addresses (Google-autocompleted); a client may have several. */
  addresses: Address[];
  companyId?: string;
  type: ContactType;
  title?: string;
  source: ContactSource;
  notes?: string;
  status: CrmStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
