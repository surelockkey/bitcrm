import {
  DEAL_TECH_ASSIGNED_EVENT,
  DEAL_UPDATED_EVENT,
  isDealTechAssignedPayload,
  isDealUpdatedPayload,
} from '../../../src/automations/deal-events';

/**
 * Locks the event names and payload shapes to what deal-service publishes
 * (`DealsService.assignTechs` / `update`, EVENTS.md) — the consumer has no
 * shared contract to import.
 */
describe('deal-events contract (as consumed by messaging)', () => {
  it('uses the deal-service event names', () => {
    expect(DEAL_TECH_ASSIGNED_EVENT).toBe('deal.tech_assigned');
    expect(DEAL_UPDATED_EVENT).toBe('deal.updated');
  });

  it('accepts the published payloads', () => {
    expect(isDealTechAssignedPayload({ dealId: 'd1', techId: 't1', assignedBy: 'u1' })).toBe(true);
    expect(isDealUpdatedPayload({ dealId: 'd1', updatedBy: 'u1' })).toBe(true);
    // deal.updated fires from places without a caller (payment status) — updatedBy is optional
    expect(isDealUpdatedPayload({ dealId: 'd1' })).toBe(true);
  });

  it('rejects anything without the ids', () => {
    expect(isDealTechAssignedPayload({ dealId: 'd1' })).toBe(false);
    expect(isDealTechAssignedPayload({ techId: 't1' })).toBe(false);
    expect(isDealTechAssignedPayload(null)).toBe(false);
    expect(isDealUpdatedPayload({})).toBe(false);
    expect(isDealUpdatedPayload('d1')).toBe(false);
  });
});
