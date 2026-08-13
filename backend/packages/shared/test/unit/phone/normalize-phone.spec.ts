import {
  normalizePhone,
  tryNormalizePhone,
  phoneMatchVariants,
} from 'src/phone/normalize-phone';

/**
 * Every service matches call endpoints against stored numbers by string
 * equality, so this function is the whole of "does a call find its client".
 */
describe('normalizePhone', () => {
  it('normalizes the ways people type a US number', () => {
    expect(normalizePhone('(404) 555-1234')).toBe('+14045551234');
    expect(normalizePhone('404-555-1234')).toBe('+14045551234');
    expect(normalizePhone('4045551234')).toBe('+14045551234');
    expect(normalizePhone('+1 404 555 1234')).toBe('+14045551234');
  });

  it('strips a national trunk prefix, which is what carriers report', () => {
    // The bug this replaced: a hand-rolled digits rule kept the 0 and the
    // number silently never matched an incoming call.
    expect(normalizePhone('+380 095 860 1427')).toBe('+380958601427');
    expect(normalizePhone('+380958601427')).toBe('+380958601427');
  });

  it('handles other international numbers', () => {
    expect(normalizePhone('+48 575 229 043')).toBe('+48575229043');
    expect(normalizePhone('+44 20 7183 8750')).toBe('+442071838750');
  });

  it('keeps input libphonenumber rejects rather than refusing the save', () => {
    // Records already exist under the old scheme; an unrelated edit to such a
    // contact must not fail because of a number typed years ago.
    expect(normalizePhone('+123123132213')).toBe('+123123132213');
  });

  it('still refuses what could never be dialled', () => {
    expect(() => normalizePhone('12345')).toThrow();
    expect(() => normalizePhone('')).toThrow();
    expect(tryNormalizePhone('client:abc')).toBeNull();
  });
});

describe('phoneMatchVariants', () => {
  it('leads with the canonical form', () => {
    expect(phoneMatchVariants('(404) 555-1234')[0]).toBe('+14045551234');
  });

  it('includes the trunk-prefixed form, for records written before the fix', () => {
    const variants = phoneMatchVariants('+380958601427');
    expect(variants[0]).toBe('+380958601427');
    expect(variants).toContain('+3800958601427');
  });

  it('returns nothing for something that is not a number', () => {
    expect(phoneMatchVariants('client:abc-123')).toEqual([]);
  });

  it('never repeats a form', () => {
    const variants = phoneMatchVariants('+14045551234');
    expect(new Set(variants).size).toBe(variants.length);
  });
});
