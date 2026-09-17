import { type Address } from './address.entity';
import { type ClientType } from '../enums/client-type.enum';
import { type DealStage, type JobSuperStatus } from '../enums/deal-stage.enum';
import { type DealPriority } from '../enums/deal-priority.enum';
import { type DealStatus } from '../enums/deal-status.enum';
import { type CustomFieldValue } from './custom-field.entity';
import { type DocumentDiscount, type DocumentTaxSource } from '../billing/totals';

/**
 * How a job is handed to a technician (Workiz "Send to tech": SMS / Email /
 * In App). `sms` texts the technician's personal phone, `email` their user
 * email, `in_app` posts into their team thread (the Workiz mobile-app
 * notification). Several may be picked at once ("Sent to tech by SMS & Email").
 */
export const SEND_TO_TECH_CHANNELS = ['sms', 'email', 'in_app'] as const;
export type SendToTechChannel = (typeof SEND_TO_TECH_CHANNELS)[number];

export interface Deal {
  id: string;
  /**
   * Human-facing Job ID: a random 6-char code of uppercase letters + digits
   * (e.g. "K4T9ZW"), unique across the table. Legacy deals carry their old
   * sequential number coerced to a string ("1042").
   */
  dealNumber: string;
  contactId: string;
  companyId?: string;
  clientType: ClientType;
  /** Start date (YYYY-MM-DD). Paired with the start time in scheduledTimeSlot. */
  scheduledDate?: string;
  /** End date (YYYY-MM-DD); defaults to the start date when the job is same-day. */
  scheduledEndDate?: string;
  /** "HH:MM-HH:MM" — start time and end time. Absent when allDay. */
  scheduledTimeSlot?: string;
  /** An all-day job carries dates only; times are dropped. */
  allDay?: boolean;
  /** Denormalized service-area name for display (auto-resolved from address). */
  serviceArea: string;
  /** Catalog service-area id this deal resolved into; null if outside coverage. */
  serviceAreaId?: string;
  address: Address;
  /** Catalog job-type id. Drives technician eligibility matching. */
  jobTypeId: string;
  /**
   * Fixed pipeline super-status (replaces the legacy 13-stage `stage`). Source of
   * truth for the board/list/reporting. Paired with an optional `subStatusId`.
   */
  superStatus: JobSuperStatus;
  /**
   * @deprecated Legacy 13-stage value, kept only so un-migrated rows still read
   * and historical timeline entries resolve. New writes set `superStatus`.
   */
  stage?: DealStage;
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
  /**
   * The business company (brand) this job is done under — drives the
   * invoice/estimate letterhead, payment terms and portal branding. Absent ⇒
   * the default company. Name is denormalized for lists.
   */
  businessProfileId?: string;
  businessProfileName?: string;
  /** Catalog job-source id (where the deal came from). Optional. */
  sourceId?: string;
  /** Catalog external-company id (the partner that referred this job). Optional. */
  externalCompanyId?: string;
  notes?: string;
  internalNotes?: string;
  cancellationReason?: string;
  /** Catalog job-tag ids applied to this deal. */
  tagIds: string[];
  /**
   * Catalog job-sub-status id (a custom colored label under a super-status).
   * Optional and independent of `stage` — a display/reporting label only.
   */
  subStatusId?: string;
  /**
   * The job's single tax rate (Workiz model: one rate per job/invoice, lines
   * only carry a `taxable` flag). Name + percent are snapshotted so editing the
   * catalog rate never silently re-prices an existing job.
   */
  taxRateId?: string;
  taxRateName?: string;
  taxRatePercent?: number;
  /** Where the current tax came from; `manual` blocks service-area re-resolution. */
  taxSource?: DocumentTaxSource;
  /** Job-level discount (shared with the job's invoice). */
  discount?: DocumentDiscount;
  /** Number of line items on the job (kept by the deal service; drives "needs invoice"). */
  itemCount?: number;
  /** Set by the billing service when the job's invoice exists (=== dealId). */
  invoiceId?: string;
  estimatedTotal?: number;
  actualTotal?: number;
  paymentStatus?: string;
  /** Platinum client Work Order this deal was authorized by (EPIC-9). */
  workOrderId?: string;
  /** Client PO number (required when the company has poRequired). */
  poNumber?: string;
  /** User-defined field answers, keyed by CustomFieldDefinition id (not name). */
  customFields?: Record<string, CustomFieldValue>;
  /**
   * Per-job override of the client's display name — set when a client edit on
   * the job is saved with "Just here" instead of being applied to the contact
   * record. Absent = the job shows the contact's own name.
   */
  clientName?: { firstName: string; lastName: string };
  status: DealStatus;
  createdBy: string;
  /**
   * When the job was closed: the moment it received a Done or Canceled status
   * (or one of their sub-statuses). Cleared if the job is reopened.
   */
  closedAt?: string;
  /**
   * When the job entered its current status (super or sub) — set at creation,
   * re-stamped by every real status move. Drives "time in status" displays.
   */
  statusChangedAt?: string;
  /**
   * Workiz `last_sent` / `sent`: the latest time a dispatcher pressed
   * "Send to tech" on this job (stamped at the click, before the messages
   * go out). Absent = never sent. Per-technician stamps live on the
   * `ASSIGN#<techId>` rows (`sentAt`, `sentVia`, `seenAt`, `deliveries`).
   */
  sentToTechAt?: string;
  /** Channels picked for the latest send — `['sms']`, `['sms', 'email']`, … */
  sentToTechVia?: SendToTechChannel[];
  /** Who pressed "Send to tech" last. */
  sentToTechBy?: string;
  /**
   * Workiz `seen`: the first time any assigned technician opened the job in
   * their app (`POST /deals/:id/seen`). Sticky — a later re-send does not
   * clear it; the per-technician `seenAt` on `ASSIGN#` says who and when.
   */
  seenByTechAt?: string;
  /**
   * Technician flow (Workiz "Confirmed job receipt"): when an assigned
   * technician acknowledged the job from their phone, and who. Absent until
   * somebody taps "Confirm receipt"; dispatch reads it as "the tech has seen
   * this". Optional — rows written before the field existed simply lack it.
   */
  techConfirmedAt?: string;
  techConfirmedBy?: string;
  /**
   * Technician flow (Workiz "Arrived at location"): when the technician
   * tapped "Arrived", who, and — when the phone offered one — the GPS fix
   * at that moment. Absent until then.
   */
  arrivedAt?: string;
  arrivedBy?: string;
  arrivedLocation?: { lat: number; lng: number; accuracy?: number };
  createdAt: string;
  updatedAt: string;
}
