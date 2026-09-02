import {
  maskPhones,
  maskPhonesEach,
  stripUnwritablePhones,
} from '../../../src/common/phone-masking';

const contact = () => ({
  id: 'c1',
  firstName: 'Maria',
  lastName: 'Alvarez',
  phones: ['+14045550111', '+14045550112'],
  emails: ['m@example.com'],
});

describe('maskPhones', () => {
  it('returns the record untouched when the viewer may see numbers', () => {
    const c = contact();
    const out = maskPhones(c, true);
    expect(out).toBe(c);
    expect(out.phones).toEqual(['+14045550111', '+14045550112']);
    expect(out).not.toHaveProperty('phonesMasked');
  });

  it('empties the numbers but keeps the count when the viewer may not', () => {
    const out = maskPhones(contact(), false);
    expect(out.phones).toEqual([]);
    expect(out.phoneCount).toBe(2);
    expect(out.phonesMasked).toBe(true);
  });

  it('leaves every other field alone', () => {
    const out = maskPhones(contact(), false);
    expect(out.firstName).toBe('Maria');
    expect(out.emails).toEqual(['m@example.com']);
  });

  it('does not mutate the input — cached records are shared', () => {
    // ContactsCacheService hands out the same object to concurrent requests, so
    // masking in place would leak an empty phones array to an allowed viewer.
    const c = contact();
    maskPhones(c, false);
    expect(c.phones).toEqual(['+14045550111', '+14045550112']);
  });

  it('reports a count of zero for a contact with no numbers', () => {
    const out = maskPhones({ ...contact(), phones: [] }, false);
    expect(out.phoneCount).toBe(0);
    expect(out.phonesMasked).toBe(true);
  });

  it('tolerates a record whose phones attribute is missing', () => {
    // A legacy row written before `phones` existed still has to render.
    const legacy: { id: string; phones?: string[] } = { id: 'c1' };
    const out = maskPhones(legacy, false);
    expect(out.phones).toEqual([]);
    expect(out.phoneCount).toBe(0);
  });

  it('masks every record in a list', () => {
    const out = maskPhonesEach([contact(), contact()], false);
    expect(out.every((c) => c.phones.length === 0)).toBe(true);
    expect(out.every((c) => c.phoneCount === 2)).toBe(true);
  });
});

describe('stripUnwritablePhones', () => {
  it('passes the payload through when the viewer may see numbers', () => {
    const dto = { firstName: 'Maria', phones: ['+14045550111'] };
    expect(stripUnwritablePhones(dto, true)).toBe(dto);
  });

  /**
   * The failure this exists for: CRM has no whitelisting ValidationPipe, and a
   * masked viewer's edit form loads `phones: []`. Submitting the form
   * unchanged would send that empty array straight back — and `if (dto.phones)`
   * is true for `[]`, so the service would rewrite the phone index and DELETE
   * every number on the contact.
   */
  it('drops an empty phones array from a masked caller', () => {
    const out = stripUnwritablePhones(
      { firstName: 'Maria', phones: [] },
      false,
    );
    expect(out).not.toHaveProperty('phones');
    expect(out.firstName).toBe('Maria');
  });

  it('drops a populated phones array from a masked caller too', () => {
    // They cannot see the current value, so they cannot have meant to replace it.
    const out = stripUnwritablePhones(
      { firstName: 'Maria', phones: ['+14045559999'] },
      false,
    );
    expect(out).not.toHaveProperty('phones');
  });

  it('leaves a payload with no phones key alone', () => {
    const out = stripUnwritablePhones({ firstName: 'Maria' }, false);
    expect(out).toEqual({ firstName: 'Maria' });
  });

  it('does not mutate the caller payload', () => {
    const dto = { firstName: 'Maria', phones: [] as string[] };
    stripUnwritablePhones(dto, false);
    expect(dto).toHaveProperty('phones');
  });
});
