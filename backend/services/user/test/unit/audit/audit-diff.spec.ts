import { diffFields } from '../../../src/audit/audit-diff';

/** What an audit line says changed: only what moved, nested fields dotted. */
describe('diffFields', () => {
  it('lists the fields that moved, from → to, and nothing else', () => {
    expect(
      diffFields({ firstName: 'Bob', department: 'tech', phone: '+1' }, { firstName: 'Rob', department: 'tech' }, [
        'firstName',
        'department',
        'phone',
      ]),
    ).toEqual({ firstName: { from: 'Bob', to: 'Rob' }, phone: { from: '+1' } });
  });

  it('answers undefined when nothing moved, so no empty line is written', () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toBeUndefined();
  });

  it('dots into objects, so one flipped permission is one change', () => {
    const before = { permissions: { contacts: { view: true, view_numbers: false }, deals: { view: true } } };
    const after = { permissions: { contacts: { view: true, view_numbers: true }, deals: { view: true } } };
    expect(diffFields(before, after)).toEqual({
      'permissions.contacts.view_numbers': { from: false, to: true },
    });
  });

  it('reads a removed or new object as every leaf removed or added', () => {
    expect(diffFields({ permissionOverrides: undefined }, { permissionOverrides: { permissions: { c: { v: true } } } })).toEqual({
      'permissionOverrides.permissions.c.v': { to: true },
    });
  });

  it('compares arrays as whole values', () => {
    expect(diffFields({ t: ['a->b'] }, { t: ['a->b', '*->c'] })).toEqual({ t: { from: ['a->b'], to: ['a->b', '*->c'] } });
    expect(diffFields({ t: ['a'] }, { t: ['a'] })).toBeUndefined();
  });

  it('only looks at the keys it is given, when given some', () => {
    expect(diffFields({ a: 1, updatedAt: 'x' }, { a: 2, updatedAt: 'y' }, ['a'])).toEqual({ a: { from: 1, to: 2 } });
  });
});
