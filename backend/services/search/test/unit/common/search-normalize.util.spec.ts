import {
  compactUnique,
  phoneQueryDigits,
  phoneSearchVariants,
} from 'src/common/utils/search-normalize.util';

describe('phoneSearchVariants', () => {
  it('produces local and 1-prefixed digit variants from a formatted US phone', () => {
    expect(phoneSearchVariants('(728) 347-8370')).toEqual(
      expect.arrayContaining(['7283478370', '17283478370']),
    );
  });

  it('normalizes a +1 international format to the same variants', () => {
    expect(phoneSearchVariants('+1 728 347 8370')).toEqual(
      expect.arrayContaining(['7283478370', '17283478370']),
    );
  });

  it('keeps a non-NANP number as its plain digit string', () => {
    expect(phoneSearchVariants('+380 67 123 4567')).toContain('380671234567');
  });

  it('emits every suffix of 4+ digits so any fragment of the number matches', () => {
    const variants = phoneSearchVariants('(292) 839-8283');
    // Users paste/type the tail or the middle of a number — the suffixes plus
    // the index's edge-ngrams cover every 4+ digit substring.
    expect(variants).toEqual(
      expect.arrayContaining([
        '8283',
        '98283',
        '398283',
        '8398283',
        '28398283',
        '928398283',
      ]),
    );
    expect(variants).not.toContain('283'); // 3-digit tails are too noisy
  });

  it('returns nothing for garbage or too-short input', () => {
    expect(phoneSearchVariants('12345')).toEqual([]);
    expect(phoneSearchVariants('')).toEqual([]);
    expect(phoneSearchVariants(undefined)).toEqual([]);
  });
});

describe('phoneQueryDigits', () => {
  it('collapses a formatted phone query to its digits', () => {
    expect(phoneQueryDigits('(728) 347-8370')).toBe('7283478370');
  });

  it('accepts an all-digit query', () => {
    expect(phoneQueryDigits('7283478370')).toBe('7283478370');
  });

  it('accepts a +1 formatted query', () => {
    expect(phoneQueryDigits('+1 (728) 347-8370')).toBe('17283478370');
  });

  it('collapses partial phone fragments from 4 digits up', () => {
    // A half-typed "(292) 8" or a pasted tail "839-8283" must still search.
    expect(phoneQueryDigits('(292) 8')).toBe('2928');
    expect(phoneQueryDigits('839-8283')).toBe('8398283');
    expect(phoneQueryDigits('83 98 28 3')).toBe('8398283');
  });

  it('rejects text queries', () => {
    expect(phoneQueryDigits('acme corp')).toBeUndefined();
    expect(phoneQueryDigits('john smith 123')).toBeUndefined();
  });

  it('rejects runs under 4 digits', () => {
    expect(phoneQueryDigits('292')).toBeUndefined();
    expect(phoneQueryDigits('(29')).toBeUndefined();
  });
});

describe('compactUnique', () => {
  it('drops blanks and duplicates while preserving order', () => {
    expect(compactUnique(['a', '', 'b', 'a', undefined, null, ' '])).toEqual(['a', 'b']);
  });
});
