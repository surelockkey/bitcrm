import { ClientType } from '../enums/client-type.enum';
import { CrmStatus } from '../enums/crm-status.enum';

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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
