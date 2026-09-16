import { type SendToTechChannel } from '../entities/deal.entity';

/**
 * Canonical contract for the events on the `deal-events` SNS topic that
 * other services consume (EVENTS.md). Publisher: deal-service. Consumers:
 * messaging-service (automations, "Send to tech" delivery), search-service
 * (index). The catalog events (`job-type.*`, `job-tag.*`, …) are documented
 * in EVENTS.md and not typed here.
 */
export const DEAL_EVENT_TOPIC = 'deal-events' as const;

export const DealEventType = {
  DEAL_CREATED: 'deal.created',
  /** Any field edit — the changed fields are NOT in the payload. */
  DEAL_UPDATED: 'deal.updated',
  DEAL_STATUS_CHANGED: 'deal.status_changed',
  DEAL_COMPLETED: 'deal.completed',
  DEAL_DELETED: 'deal.deleted',
  /** Once per technician added to the roster. */
  DEAL_TECH_ASSIGNED: 'deal.tech_assigned',
  DEAL_TECH_UNASSIGNED: 'deal.tech_unassigned',
  /** The job's date, end date or time slot moved (also emitted alongside `deal.updated`). */
  DEAL_SCHEDULED_CHANGED: 'deal.scheduled_changed',
  /** A dispatcher pressed "Send to tech" — messaging delivers the job text per channel. */
  SENT_TO_TECH: 'deal.sent_to_tech',
} as const;

export type DealEventType = (typeof DealEventType)[keyof typeof DealEventType];

// --- Payloads ---

export interface DealCreatedEvent {
  dealId: string;
  dealNumber?: string;
  contactId?: string;
  jobTypeId?: string;
  superStatus?: string;
  createdBy?: string;
}

export interface DealUpdatedEvent {
  dealId: string;
  updatedBy?: string;
}

export interface DealStatusChangedEvent {
  dealId: string;
  oldStatus: string;
  newStatus: string;
  /** Sub-status ids before / after; absent when the row had none (older publishers omit both). */
  oldSubStatusId?: string | null;
  newSubStatusId?: string | null;
  changedBy?: string;
}

export interface DealTechAssignedEvent {
  dealId: string;
  techId: string;
  assignedBy?: string;
}

export interface DealTechUnassignedEvent {
  dealId: string;
  techId: string;
  unassignedBy?: string;
}

export interface DealScheduleSlice {
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  allDay?: boolean;
}

export interface DealScheduledChangedEvent {
  dealId: string;
  from: DealScheduleSlice;
  to: DealScheduleSlice;
  updatedBy?: string;
}

export interface DealDeletedEvent {
  dealId: string;
  deletedBy?: string;
}

/**
 * `deal.sent_to_tech` — one event per click, however many technicians and
 * channels were picked. `sentAt` is the idempotency key the consumer uses
 * per (deal, technician, channel): a redelivery of the same event sends
 * nothing twice, a later click (new `sentAt`) sends again.
 */
export interface DealSentToTechEvent {
  dealId: string;
  /** Human-facing Job ID, for the message subject / log lines. */
  dealNumber?: string;
  /** The technicians to notify — a subset of the roster at click time. */
  techIds: string[];
  channels: SendToTechChannel[];
  /** ISO-8601; equals the deal's `sentToTechAt` after this click. */
  sentAt: string;
  /** The dispatcher who pressed the button. */
  sentBy: string;
}
