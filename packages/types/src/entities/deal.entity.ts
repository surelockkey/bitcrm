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
  /** All technicians assigned to this deal (equal peers). Empty = unassigned. */
  assignedTechIds: string[];
  assignedDispatcherId: string;
  /**
   * Per-technician visit order for the day: `techId → position`. A deal shared
   * by several techs can be job #2 for one and #4 for another. Absent entries
   * fall back to scheduled-time order.
   */
  sequences?: Record<string, number>;
  priority: DealPriority;
  /** Catalog job-source id (where the deal came from). Optional. */
  sourceId?: string;
  notes?: string;
  internalNotes?: string;
  cancellationReason?: string;
  /** Catalog job-tag ids applied to this deal. */
  tagIds: string[];
  estimatedTotal?: number;
  actualTotal?: number;
  paymentStatus?: string;
  status: DealStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
