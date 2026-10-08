import {
  affectsEligibility,
  affectsProjection,
  TechChangedField,
  UserEventType,
  USER_EVENT_TOPIC,
} from '@bitcrm/types';

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

  /**
   * `changedFields` is as much a wire format as the event name: the consumer
   * skips a re-read on anything it doesn't recognise. Both services used to
   * keep their own copy of the `'assignments'` string, which is how two of the
   * three ways out of dispatch ended up with no marker at all.
   */
  it('has stable changedFields markers', () => {
    expect(TechChangedField).toEqual({
      ASSIGNMENTS: 'assignments',
      ROLE: 'role',
      STATUS: 'status',
      FIELD_TEAM: 'fieldTeamMember',
      NAME: 'name',
    });
  });

  /**
   * deal-service's technician projection prints a name (the jobs list's
   * `included`, Assign A Tech), so a rename is worth a re-read even though it
   * moves nobody in or out of dispatch.
   */
  it('re-reads the projection on a rename, and on every eligibility marker', () => {
    expect(affectsProjection(['name'])).toBe(true);
    expect(affectsProjection(['assignments'])).toBe(true);
    expect(affectsProjection(['role'])).toBe(true);
    expect(affectsProjection(['status'])).toBe(true);
    expect(affectsProjection(['fieldTeamMember'])).toBe(true);
    expect(affectsProjection(['commission'])).toBe(false);
    expect(affectsProjection(undefined)).toBe(false);
    // A rename is not an eligibility change.
    expect(affectsEligibility(['name'])).toBe(false);
  });

  it('treats every eligibility marker as worth a re-read, and nothing else', () => {
    expect(affectsEligibility(['assignments'])).toBe(true);
    expect(affectsEligibility(['role'])).toBe(true);
    expect(affectsEligibility(['status'])).toBe(true);
    expect(affectsEligibility(['fieldTeamMember'])).toBe(true);
    expect(affectsEligibility(['commission', 'role'])).toBe(true);
    expect(affectsEligibility(['commission'])).toBe(false);
    expect(affectsEligibility([])).toBe(false);
    expect(affectsEligibility(undefined)).toBe(false);
  });
});
