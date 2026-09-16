/**
 * What deal-service publishes on `deal-events` (EVENTS.md,
 * `DealsService.publishEvent`) and the automations consume through the
 * `deal-events-to-messaging` queue — the queue subscribes to the whole
 * topic, so every one of these already arrives; the canonical shapes are
 * `@bitcrm/types` `events/deal-events.ts` and the guards below are what the
 * consumer checks before touching a payload.
 *
 *   deal.created         { dealId, dealNumber?, contactId?, jobTypeId?, superStatus?, createdBy? }
 *   deal.updated         { dealId, updatedBy? }          any field edit — the changed fields are NOT in
 *                                                        the payload; a reschedule is detected by
 *                                                        re-reading the job and comparing its schedule
 *                                                        with the DEALSNAP# snapshot
 *   deal.status_changed  { dealId, oldStatus, newStatus, changedBy? }
 *                                                        sub-status ids are NOT published today; the
 *                                                        engine fills them from the job it re-reads
 *   deal.tech_assigned   { dealId, techId, assignedBy }  once per technician added to the roster
 *
 * `deal.scheduled_changed` is typed in `@bitcrm/types` but deal-service
 * does not publish it yet (verified 2026-09-16). The consumer accepts it if
 * it ever arrives and, until then, synthesizes it from `deal.updated`
 * (`DealSnapshotRepository`), so a reschedule rule works either way.
 */
export const DEAL_CREATED_EVENT = 'deal.created';
export const DEAL_TECH_ASSIGNED_EVENT = 'deal.tech_assigned';
export const DEAL_UPDATED_EVENT = 'deal.updated';
export const DEAL_STATUS_CHANGED_EVENT = 'deal.status_changed';
export const DEAL_SCHEDULED_CHANGED_EVENT = 'deal.scheduled_changed';

/**
 * `call.completed` on the `call-events` topic (telephony-service,
 * `CallsService.applyLifecycle`; payload `CallCompletedEvent` in
 * `@bitcrm/types`) — what the Workiz "missed call" rules listen to. It
 * reaches messaging through its own `call-events-to-messaging` queue.
 */
export const CALL_COMPLETED_EVENT = 'call.completed';

export interface DealTechAssignedPayload {
  dealId: string;
  techId: string;
  assignedBy?: string;
}

export interface DealUpdatedPayload {
  dealId: string;
  updatedBy?: string;
}

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export const isDealTechAssignedPayload = (p: unknown): p is DealTechAssignedPayload =>
  !!p &&
  typeof p === 'object' &&
  nonEmptyString((p as DealTechAssignedPayload).dealId) &&
  nonEmptyString((p as DealTechAssignedPayload).techId);

export const isDealUpdatedPayload = (p: unknown): p is DealUpdatedPayload =>
  !!p && typeof p === 'object' && nonEmptyString((p as DealUpdatedPayload).dealId);

export interface DealCreatedPayload {
  dealId: string;
  dealNumber?: string;
  contactId?: string;
  jobTypeId?: string;
  superStatus?: string;
  createdBy?: string;
}

export interface DealStatusChangedPayload {
  dealId: string;
  oldStatus?: string;
  newStatus?: string;
  /** Not published today; the engine reads the job for them. */
  oldSubStatusId?: string | null;
  newSubStatusId?: string | null;
  changedBy?: string;
}

export interface DealScheduleSlicePayload {
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  allDay?: boolean;
}

export interface DealScheduledChangedPayload {
  dealId: string;
  from?: DealScheduleSlicePayload;
  to?: DealScheduleSlicePayload;
  updatedBy?: string;
}

/** Every job event carries a `dealId` — that alone makes a payload usable. */
export const hasDealId = (p: unknown): p is { dealId: string } =>
  !!p && typeof p === 'object' && nonEmptyString((p as { dealId?: unknown }).dealId);

export const isDealCreatedPayload = (p: unknown): p is DealCreatedPayload => hasDealId(p);

export const isDealStatusChangedPayload = (p: unknown): p is DealStatusChangedPayload => hasDealId(p);

export const isDealScheduledChangedPayload = (p: unknown): p is DealScheduledChangedPayload => hasDealId(p);
