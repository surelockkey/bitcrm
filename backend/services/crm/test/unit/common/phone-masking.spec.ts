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

  /**
   * The leak this closes: `phoneExtensions` is keyed BY THE NUMBER, so
   * blanking `phones` while keeping the map handed a masked viewer every
   * number with an extension, in its keys.
   */
  describe('extensions', () => {
    const withExt = () => ({
      ...contact(),
      phoneExtensions: { '+14045550112': '102' },
    });

    it('drops the number-keyed map for a masked viewer', () => {
      const out = maskPhones(withExt(), false);
      expect(out).not.toHaveProperty('phoneExtensions');
      expect(JSON.stringify(out)).not.toContain('+1404555');
    });

    it('hands the extensions back by position, aligned with the hidden rows', () => {
      const out = maskPhones(withExt(), false);
      expect(out.phoneExtensionsByIndex).toEqual(['', '102']);
    });

    it('sends no per-position list when there is nothing to press', () => {
      const out = maskPhones(contact(), false);
      expect(out).not.toHaveProperty('phoneExtensionsByIndex');
    });

    it('leaves an allowed viewer’s map alone', () => {
      const c = withExt();
      expect(maskPhones(c, true)).toBe(c);
    });

    it('does not mutate the input', () => {
      const c = withExt();
      maskPhones(c, false);
      expect(c.phoneExtensions).toEqual({ '+14045550112': '102' });
    });
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

  /**
   * A masked viewer never sees the number-keyed map, so a save from them
   * carries `{}` or nothing — and `{}` would be re-keyed against the numbers
   * on file and wipe every extension the client has.
   */
  it('drops the extensions from a masked caller too', () => {
    const out = stripUnwritablePhones(
      { firstName: 'Maria', phones: [], phoneExtensions: {} },
      false,
    );
    expect(out).not.toHaveProperty('phoneExtensions');
    expect(out).not.toHaveProperty('phones');
  });

  it('keeps an allowed caller’s extensions', () => {
    const dto = { phones: ['+14045550111'], phoneExtensions: { '+14045550111': '7' } };
    expect(stripUnwritablePhones(dto, true)).toBe(dto);
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
