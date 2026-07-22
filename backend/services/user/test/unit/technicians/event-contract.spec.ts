import { UserEventType, USER_EVENT_TOPIC } from '@bitcrm/types';

/**
 * Locks the wire format of the user-events contract. A change here is a
 * breaking change for every consumer (deal-service, inventory-service) and must
 * be made deliberately.
 */
describe('user-events contract', () => {
  it('publishes on the user-events topic key', () => {
    expect(USER_EVENT_TOPIC).toBe('user-events');
  });

  it('has stable event-type strings', () => {
    expect(UserEventType).toEqual({
      USER_ACTIVATED: 'user.activated',
      USER_ROLE_CHANGED: 'user.role-changed',
      USER_INVITE_RESENT: 'user.invite-resent',
      TECH_UPDATED: 'tech.updated',
      TECH_APPROVED: 'tech.approved',
      COMMISSION_UPDATED: 'commission.updated',
      DOCUMENT_UPLOADED: 'document.uploaded',
      DOCUMENT_ACCESSED: 'document.accessed',
      DOCUMENT_DELETED: 'document.deleted',
      SENSITIVE_ACCESSED: 'sensitive.accessed',
    });
  });
});
