import { normalizeUserSearch, userMatchesSearch } from '../../../src/users/user-search';

/**
 * Пошук у довіднику користувачів — «містить» без урахування регістру по імені,
 * прізвищу, повному імені та email, як пошук на інших вкладках інвентарю.
 */
describe('normalizeUserSearch', () => {
  it('trims, lowercases and collapses inner whitespace', () => {
    expect(normalizeUserSearch('  John   SMITH ')).toBe('john smith');
  });

  it('a blank or missing term is no search at all', () => {
    expect(normalizeUserSearch('   ')).toBeUndefined();
    expect(normalizeUserSearch('')).toBeUndefined();
    expect(normalizeUserSearch(undefined)).toBeUndefined();
  });
});

describe('userMatchesSearch', () => {
  const john = { firstName: 'John', lastName: 'Smith', email: 'J.Doe@Example.com' };

  it('matches any part of the first name, last name or email, whatever the case', () => {
    expect(userMatchesSearch(john, 'joh')).toBe(true);
    expect(userMatchesSearch(john, 'mit')).toBe(true);
    expect(userMatchesSearch(john, 'doe@example')).toBe(true);
    expect(userMatchesSearch(john, 'nobody')).toBe(false);
  });

  it('matches across the full name', () => {
    expect(userMatchesSearch(john, 'john sm')).toBe(true);
    expect(userMatchesSearch(john, 'smith john')).toBe(false);
  });

  it('tolerates a record with missing fields', () => {
    expect(userMatchesSearch({ email: 'ops@example.com' }, 'ops')).toBe(true);
    expect(userMatchesSearch({}, 'ops')).toBe(false);
  });
});
