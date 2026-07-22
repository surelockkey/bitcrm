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
  /** Denormalized service-area name for display (auto-resolved from address). */
  serviceArea: string;
  /** Catalog service-area id this deal resolved into; null if outside coverage. */
  serviceAreaId?: string;
  address: Address;
  /** Catalog job-type id. Drives technician eligibility matching. */
  jobTypeId: string;
  stage: DealStage;
  assignedTechId?: string;
  assignedDispatcherId: string;
  sequenceNumber?: number;
  priority: DealPriority;
  /** Catalog job-source id (where the deal came from). Optional. */
  sourceId?: string;
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
