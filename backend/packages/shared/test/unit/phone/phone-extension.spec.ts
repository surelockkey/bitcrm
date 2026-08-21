import {
  normalizeExtension,
  normalizePhoneExtensions,
} from 'src/phone/phone-extension';

/**
 * An extension is a dial string, not prose: whatever the user types has to
 * reduce to the keys somebody actually presses after the call connects.
 */
describe('normalizeExtension', () => {
  it('keeps the digits people press', () => {
    expect(normalizeExtension('102')).toBe('102');
    expect(normalizeExtension(' 4 ')).toBe('4');
  });

  it('drops the wrapper people type around it', () => {
    expect(normalizeExtension('ext. 102')).toBe('102');
    expect(normalizeExtension('x102')).toBe('102');
    expect(normalizeExtension('press 2')).toBe('2');
  });

  it('keeps DTMF keys and pauses', () => {
    expect(normalizeExtension('*21')).toBe('*21');
    expect(normalizeExtension('#5')).toBe('#5');
    expect(normalizeExtension(',,102')).toBe(',,102');
  });

  it('caps the length so the field stays a dial string', () => {
    expect(normalizeExtension('12345678901234')).toBe('1234567890');
  });

  it('is empty when there is nothing to dial', () => {
    expect(normalizeExtension('')).toBe('');
    expect(normalizeExtension('  ')).toBe('');
    expect(normalizeExtension('ask for dispatch')).toBe('');
  });
});

/**
 * Extensions are keyed by the number they belong to, so the map has to be
 * re-keyed to the same E.164 form the phone list was normalized to — and an
 * entry whose number is gone has to go with it, or a later edit would
 * resurrect an extension on a number the contact no longer has.
 */
describe('normalizePhoneExtensions', () => {
  it('re-keys entries to the normalized phone', () => {
    expect(
      normalizePhoneExtensions({ '(404) 555-1234': '102' }, ['+14045551234']),
    ).toEqual({ '+14045551234': '102' });
  });

  it('drops entries for numbers the record no longer has', () => {
    expect(
      normalizePhoneExtensions(
        { '+14045551234': '102', '+15558675309': '7' },
        ['+14045551234'],
      ),
    ).toEqual({ '+14045551234': '102' });
  });

  it('drops blank extensions rather than storing empty strings', () => {
    expect(
      normalizePhoneExtensions({ '+14045551234': '  ' }, ['+14045551234']),
    ).toEqual({});
  });

  it('matches a stored phone that never parsed, by its raw key', () => {
    // Company main lines keep unparseable entries verbatim.
    expect(
      normalizePhoneExtensions({ 'main line': '3' }, ['main line']),
    ).toEqual({ 'main line': '3' });
  });

  it('is an empty map when there is nothing to keep', () => {
    expect(normalizePhoneExtensions(undefined, ['+14045551234'])).toEqual({});
    expect(normalizePhoneExtensions({}, [])).toEqual({});
  });
});
