import { DealEventType, type DealSentToTechEvent } from '@bitcrm/types';
import {
  DEAL_TECH_ASSIGNED_EVENT,
  DEAL_UPDATED_EVENT,
  isDealSentToTechPayload,
  isDealTechAssignedPayload,
  isDealUpdatedPayload,
} from '../../../src/automations/deal-events';

/**
 * Locks the event names and payload shapes to what deal-service publishes
 * (`DealsService.assignTechs` / `update` / `sendToTech`, EVENTS.md) — only
 * `deal.sent_to_tech` has a shared contract to import.
 */
describe('deal-events contract (as consumed by messaging)', () => {
  it('uses the deal-service event names', () => {
    expect(DEAL_TECH_ASSIGNED_EVENT).toBe('deal.tech_assigned');
    expect(DEAL_UPDATED_EVENT).toBe('deal.updated');
    expect(DealEventType.SENT_TO_TECH).toBe('deal.sent_to_tech');
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

  it('accepts a deal.sent_to_tech exactly as DealsService.sendToTech publishes it', () => {
    const published: DealSentToTechEvent = {
      dealId: 'd1',
      dealNumber: '1001',
      techIds: ['t1', 't2'],
      channels: ['sms', 'in_app', 'email'],
      sentAt: '2026-09-16T10:00:00.000Z',
      sentBy: 'disp-1',
    };
    expect(isDealSentToTechPayload(published)).toBe(true);
    // dealNumber is the only optional field.
    expect(isDealSentToTechPayload({ ...published, dealNumber: undefined })).toBe(true);
  });

  it('drops a sent_to_tech that would deliver the wrong thing', () => {
    const base = { dealId: 'd1', techIds: ['t1'], channels: ['sms'], sentAt: '2026-09-16T10:00:00.000Z', sentBy: 'disp-1' };
    expect(isDealSentToTechPayload({ ...base, techIds: [] })).toBe(false);
    expect(isDealSentToTechPayload({ ...base, techIds: ['t1', ''] })).toBe(false);
    expect(isDealSentToTechPayload({ ...base, channels: [] })).toBe(false);
    // A channel this build cannot deliver must surface, not half-send.
    expect(isDealSentToTechPayload({ ...base, channels: ['sms', 'fax'] })).toBe(false);
    expect(isDealSentToTechPayload({ ...base, sentAt: '' })).toBe(false);
    expect(isDealSentToTechPayload({ ...base, dealId: undefined })).toBe(false);
    expect(isDealSentToTechPayload(null)).toBe(false);
  });
});
