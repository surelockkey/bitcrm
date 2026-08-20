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

  it('rejects text queries', () => {
    expect(phoneQueryDigits('acme corp')).toBeUndefined();
    expect(phoneQueryDigits('john smith 123')).toBeUndefined();
  });

  it('rejects short digit runs (deal numbers, zips)', () => {
    expect(phoneQueryDigits('1042')).toBeUndefined();
    expect(phoneQueryDigits('728-347')).toBeUndefined();
  });
});

describe('compactUnique', () => {
  it('drops blanks and duplicates while preserving order', () => {
    expect(compactUnique(['a', '', 'b', 'a', undefined, null, ' '])).toEqual(['a', 'b']);
  });
});
