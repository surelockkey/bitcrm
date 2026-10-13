/**
 * The client list's index (GSI2 ContactListIndex): a sparse
 * `CONTACTS#ACTIVE` / `<name lowercased>#<id>` key on the METADATA row of
 * every active contact, so `GET /contacts` and `/contacts/count` Query one
 * partition — A→Z, the order the web's Clients grid shows by default —
 * instead of Scanning the whole contacts table (PHONE# and NOTE# rows too).
 */
import {
  CONTACT_LIST_PK,
  CONTACT_LIST_STATE_KEY,
  contactListKeys,
  contactListWrite,
  hasContactListCursorKeys,
  isMissingIndexError,
  planContactList,
} from 'src/contacts/contact-list-index';

const row = (over: Record<string, unknown> = {}) => ({
  PK: 'CONTACT#c-1',
  SK: 'METADATA',
  id: 'c-1',
  firstName: 'John',
  lastName: 'Doe',
  status: 'active',
  ...over,
});

describe('contactListKeys', () => {
  it('files an active contact under CONTACTS#ACTIVE by its lowercased display name', () => {
    expect(contactListKeys(row())).toEqual({ GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#c-1' });
    expect(CONTACT_LIST_PK).toBe('CONTACTS#ACTIVE');
  });

  it('is sparse: a deleted contact, a row with no status and a non-contact row have no keys', () => {
    expect(contactListKeys(row({ status: 'deleted' }))).toBeUndefined();
    expect(contactListKeys(row({ status: undefined }))).toBeUndefined();
    expect(contactListKeys({ PK: 'PHONE#+1404', SK: 'CONTACT#c-1', contactId: 'c-1' })).toBeUndefined();
    expect(contactListKeys(row({ SK: 'NOTE#2026#n-1' }))).toBeUndefined();
  });

  it('trims the name as the grid does and survives a missing half', () => {
    expect(contactListKeys(row({ firstName: '  Ann ', lastName: undefined }))?.GSI2SK).toBe('ann#c-1');
    expect(contactListKeys(row({ firstName: undefined, lastName: undefined }))?.GSI2SK).toBe('#c-1');
  });

  it('keeps at most 200 characters of the name, so a key never outgrows DynamoDB', () => {
    const sk = contactListKeys(row({ firstName: 'x'.repeat(500) }))!.GSI2SK;
    expect(sk).toBe(`${'x'.repeat(200)}#c-1`);
  });

  it('takes the id from the key when the row lacks the attribute', () => {
    expect(contactListKeys(row({ id: undefined }))?.GSI2SK).toBe('john doe#c-1');
  });
});

describe('planContactList', () => {
  it('leaves a correctly filed row alone', () => {
    expect(planContactList(row({ GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#c-1' }))).toEqual({ action: 'same' });
  });

  it('sets the keys on an unfiled active row and re-files a renamed one', () => {
    expect(planContactList(row())).toEqual({ action: 'set', pk: CONTACT_LIST_PK, sk: 'john doe#c-1' });
    expect(planContactList(row({ GSI2PK: CONTACT_LIST_PK, GSI2SK: 'jon doe#c-1' }))).toEqual({
      action: 'set',
      pk: CONTACT_LIST_PK,
      sk: 'john doe#c-1',
    });
  });

  it('removes the keys from a row that no longer qualifies', () => {
    expect(planContactList(row({ status: 'deleted', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'john doe#c-1' }))).toEqual({
      action: 'remove',
    });
    expect(planContactList(row({ status: 'deleted' }))).toEqual({ action: 'same' });
  });
});

describe('contactListWrite', () => {
  it('sets the keys guarded on the inputs as they were read', () => {
    const w = contactListWrite(row(), { action: 'set', pk: CONTACT_LIST_PK, sk: 'john doe#c-1' });
    expect(w.UpdateExpression).toBe('SET GSI2PK = :gsi2pk, GSI2SK = :gsi2sk');
    expect(w.ConditionExpression).toContain('attribute_exists(PK)');
    expect(w.ConditionExpression).toContain('#cl_status = :cl_status');
    expect(w.ConditionExpression).toContain('#cl_firstName = :cl_firstName');
    expect(w.ExpressionAttributeValues).toMatchObject({
      ':gsi2pk': CONTACT_LIST_PK,
      ':gsi2sk': 'john doe#c-1',
      ':cl_status': 'active',
      ':cl_firstName': 'John',
      ':cl_lastName': 'Doe',
    });
  });

  it('removes the keys; a missing input is guarded as absent', () => {
    const w = contactListWrite(row({ status: 'deleted', lastName: undefined }), { action: 'remove' });
    expect(w.UpdateExpression).toBe('REMOVE GSI2PK, GSI2SK');
    expect(w.ConditionExpression).toContain('attribute_not_exists(#cl_lastName)');
  });
});

describe('cursor shape and errors', () => {
  it('tells an index cursor from a Scan-era one', () => {
    expect(hasContactListCursorKeys({ PK: 'a', SK: 'b', GSI2PK: CONTACT_LIST_PK, GSI2SK: 'x#a' })).toBe(true);
    expect(hasContactListCursorKeys({ PK: 'a', SK: 'b' })).toBe(false);
    expect(hasContactListCursorKeys(undefined)).toBe(false);
  });

  it('recognises the answer of a Query on an index the table does not have yet', () => {
    expect(isMissingIndexError({ name: 'ValidationException', message: 'The table does not have the specified index' })).toBe(true);
    expect(isMissingIndexError({ name: 'ValidationException', message: 'Something else' })).toBe(false);
    expect(isMissingIndexError(new Error('index'))).toBe(false);
  });

  it('has a readiness row key of its own', () => {
    expect(CONTACT_LIST_STATE_KEY).toEqual({ PK: 'CONTACTLISTINDEX', SK: 'STATE' });
  });
});
