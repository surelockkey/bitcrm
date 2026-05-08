import { ContactType } from '../enums/contact-type.enum';
import { ContactSource } from '../enums/contact-source.enum';
import { CrmStatus } from '../enums/crm-status.enum';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phones: string[];
  emails: string[];
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
