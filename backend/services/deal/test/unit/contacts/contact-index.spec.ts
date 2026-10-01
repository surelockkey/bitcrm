import {
  CONTACT_ACTIVITY_INDEX,
  attachmentContactKeys,
  contactActivityPk,
  contactFilePk,
  timelineContactKeys,
} from 'src/contacts/contact-index';

/**
 * GSI10 ContactActivityIndex: one sparse index, two kinds of rows — a job's
 * events under CONTACT#<contactId>, its files under CONTACTFILE#<contactId>,
 * both ordered by time then id, so a client's history and files page newest
 * first off one Query each.
 */
describe('ContactActivityIndex keys', () => {
  it('is GSI10', () => {
    expect(CONTACT_ACTIVITY_INDEX).toBe('ContactActivityIndex');
  });

  it('keys a timeline row by contact, time and id', () => {
    expect(timelineContactKeys('c-1', '2026-09-30T10:00:00.000Z', 'ev-1')).toEqual({
      GSI10PK: 'CONTACT#c-1',
      GSI10SK: '2026-09-30T10:00:00.000Z#ev-1',
    });
    expect(contactActivityPk('c-1')).toBe('CONTACT#c-1');
  });

  it('keys an attachment row under its own prefix, so files never mix with events', () => {
    expect(attachmentContactKeys('c-1', '2026-09-30T10:00:00.000Z', 'att-1')).toEqual({
      GSI10PK: 'CONTACTFILE#c-1',
      GSI10SK: '2026-09-30T10:00:00.000Z#att-1',
    });
    expect(contactFilePk('c-1')).toBe('CONTACTFILE#c-1');
  });
});
