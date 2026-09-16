import { SEND_TO_TECH_CHANNELS, type DealSentToTechEvent } from '@bitcrm/types';

/**
 * What deal-service publishes on `deal-events` (EVENTS.md,
 * `DealsService.publishEvent`) and the automations consume through the
 * `deal-events-to-messaging` queue. Most deal events have no typed contract
 * in `@bitcrm/types`, so their shapes are pinned here.
 *
 *   deal.tech_assigned  { dealId, techId, assignedBy }   once per technician added to the roster
 *   deal.updated        { dealId, updatedBy? }           any field edit — the changed fields are NOT in
 *                                                        the payload; a reschedule is detected by
 *                                                        re-reading the job and comparing scheduledDate
 *                                                        with the AUTOSENT# marker
 *   deal.sent_to_tech   DealSentToTechEvent              a dispatcher pressed "Send to tech"; typed in
 *                                                        `@bitcrm/types` so publisher and consumer share it
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

/**
 * `deal.sent_to_tech`. Everything the consumer branches on must be there —
 * an event without technicians, without a known channel or without the
 * `sentAt` that keys the idempotency would deliver the wrong thing, so it
 * is dropped rather than guessed at. Unknown channels are not tolerated:
 * a newer deal-service naming a channel this build cannot deliver should
 * surface as a dropped-payload warning, not a silent half-send.
 */
export const isDealSentToTechPayload = (p: unknown): p is DealSentToTechEvent => {
  if (!p || typeof p !== 'object') return false;
  const e = p as DealSentToTechEvent;
  return (
    nonEmptyString(e.dealId) &&
    nonEmptyString(e.sentAt) &&
    Array.isArray(e.techIds) &&
    e.techIds.length > 0 &&
    e.techIds.every(nonEmptyString) &&
    Array.isArray(e.channels) &&
    e.channels.length > 0 &&
    e.channels.every((c) => (SEND_TO_TECH_CHANNELS as readonly string[]).includes(c))
  );
};
