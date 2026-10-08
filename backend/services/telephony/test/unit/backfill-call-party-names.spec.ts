import {
  contactName,
  planPartyNames,
  userName,
  type NameBook,
} from '../../src/scripts/backfill-call-party-names';

/**
 * Скрипт, що ставить `partyNames` на рядки дзвінків, яких ніхто не відкривав
 * (кожен імпортований з Workiz). Він мусить дати ТОЙ САМИЙ текст, що й
 * читання журналу, інакше перше ж відкриття переписало б рядок знову.
 */

const book = (): NameBook => ({
  users: new Map([['u9', 'Tamir Levi']]),
  contacts: new Map([['c1', 'Jane Roe']]),
  companies: new Map([['co1', 'Acme Locks']]),
});

describe('names, the way the services print them', () => {
  it('a user: first and last name, else the email (UserNamesService)', () => {
    expect(userName({ firstName: 'Tamir', lastName: 'Levi', email: 't@x' })).toBe('Tamir Levi');
    expect(userName({ firstName: '', lastName: '', email: 't@x' })).toBe('t@x');
    expect(userName({})).toBeUndefined();
  });

  it('a contact: first and last name, trimmed (crm findManyByRef)', () => {
    expect(contactName({ firstName: 'Jane', lastName: '' })).toBe('Jane');
    expect(contactName({ firstName: 'Jane', lastName: 'Roe' })).toBe('Jane Roe');
  });
});

describe('planPartyNames', () => {
  it('names a frozen client and a frozen teammate, from then to', () => {
    const plan = planPartyNames(
      { PK: 'CALL#CA1', fromPartyKind: 'contact', fromPartyId: 'c1', toPartyKind: 'user', toPartyId: 'u9' },
      book(),
    );

    expect(plan).toEqual({ action: 'set', partyNames: 'jane roe\ntamir levi' });
  });

  it('an imported call carries its client on one side only — so does the read path', () => {
    expect(planPartyNames({ PK: 'CALL#CA1', fromPartyKind: 'contact', fromPartyId: 'c1' }, book())).toEqual({
      action: 'set',
      partyNames: 'jane roe',
    });
  });

  it('a company main line is named by its title', () => {
    expect(planPartyNames({ PK: 'CALL#CA1', toPartyKind: 'company', toPartyId: 'co1' }, book())).toEqual({
      action: 'set',
      partyNames: 'acme locks',
    });
  });

  it('a row already right is left alone', () => {
    expect(
      planPartyNames({ PK: 'CALL#CA1', fromPartyKind: 'contact', fromPartyId: 'c1', partyNames: 'jane roe' }, book()),
    ).toEqual({ action: 'same' });
  });

  it('a renamed client is restamped', () => {
    expect(
      planPartyNames({ PK: 'CALL#CA1', fromPartyKind: 'contact', fromPartyId: 'c1', partyNames: 'jane smith' }, book()),
    ).toEqual({ action: 'set', partyNames: 'jane roe' });
  });

  it('a party nobody holds any more is not guessed at — the row is left as it is', () => {
    expect(planPartyNames({ PK: 'CALL#CA1', fromPartyKind: 'contact', fromPartyId: 'gone' }, book())).toEqual({
      action: 'unknown',
    });
  });

  it('a row with no frozen association waits for its first read (which resolves by number)', () => {
    expect(planPartyNames({ PK: 'CALL#CA1', from: '+14045551234' }, book())).toEqual({ action: 'unfrozen' });
  });

  it('the hidden internal leg is never listed, so never searched', () => {
    expect(
      planPartyNames({ PK: 'CALL#CA1', internalLegOf: 'CA0', fromPartyKind: 'contact', fromPartyId: 'c1' }, book()),
    ).toEqual({ action: 'same' });
  });
});
