/**
 * What deal-service publishes on `deal-events` (EVENTS.md,
 * `DealsService.publishEvent`) and the automations consume through the
 * `deal-events-to-messaging` queue. No typed contract exists in
 * `@bitcrm/types` for deal events, so the two shapes are pinned here.
 *
 *   deal.tech_assigned  { dealId, techId, assignedBy }   once per technician added to the roster
 *   deal.updated        { dealId, updatedBy? }           any field edit — the changed fields are NOT in
 *                                                        the payload; a reschedule is detected by
 *                                                        re-reading the job and comparing scheduledDate
 *                                                        with the AUTOSENT# marker
 *
 * Not consumed: deal.created (carries no roster — assignment follows as
 * tech_assigned), deal.status_changed, deal.tech_unassigned.
 */
export const DEAL_TECH_ASSIGNED_EVENT = 'deal.tech_assigned';
export const DEAL_UPDATED_EVENT = 'deal.updated';

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
