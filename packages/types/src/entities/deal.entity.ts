import { type Address } from './address.entity';
import { type ClientType } from '../enums/client-type.enum';
import { type DealStage } from '../enums/deal-stage.enum';
import { type DealPriority } from '../enums/deal-priority.enum';
import { type DealStatus } from '../enums/deal-status.enum';

export interface Deal {
  id: string;
  dealNumber: number;
  contactId: string;
  companyId?: string;
  clientType: ClientType;
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  serviceArea: string;
  address: Address;
  jobType: string;
  stage: DealStage;
  assignedTechId?: string;
  assignedDispatcherId: string;
  sequenceNumber?: number;
  priority: DealPriority;
  source?: string;
  notes?: string;
  internalNotes?: string;
  cancellationReason?: string;
  tags: string[];
  estimatedTotal?: number;
  actualTotal?: number;
  paymentStatus?: string;
  status: DealStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
