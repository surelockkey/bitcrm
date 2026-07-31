import { DEAL_NUMBER_CHARSET, DEAL_NUMBER_LENGTH, generateDealNumberCode, isDealNumberCode } from 'src/deals/deal-number.util';

describe('generateDealNumberCode', () => {
  it('returns a 6-character string', () => {
    expect(generateDealNumberCode()).toHaveLength(DEAL_NUMBER_LENGTH);
    expect(DEAL_NUMBER_LENGTH).toBe(6);
  });

  it('uses only uppercase letters and digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateDealNumberCode()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('always contains at least one letter and one digit (never collides with legacy numeric ids)', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateDealNumberCode();
      expect(code).toMatch(/[A-Z]/);
      expect(code).toMatch(/[0-9]/);
    }
  });

  it('produces different codes across calls', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateDealNumberCode()));
    expect(codes.size).toBe(100);
  });

  it('draws every character from the published charset', () => {
    for (let i = 0; i < 100; i++) {
      for (const ch of generateDealNumberCode()) {
        expect(DEAL_NUMBER_CHARSET).toContain(ch);
      }
    }
  });
});

describe('isDealNumberCode', () => {
  it('accepts a 6-char mixed letter+digit code, case-insensitively', () => {
    expect(isDealNumberCode('AB12CD')).toBe(true);
    expect(isDealNumberCode('ab12cd')).toBe(true);
    expect(isDealNumberCode('X9Y8Z7')).toBe(true);
  });

  it('rejects pure-digit strings (legacy sequential ids take that path)', () => {
    expect(isDealNumberCode('123456')).toBe(false);
  });

  it('rejects pure-letter strings (likely a name search)', () => {
    expect(isDealNumberCode('SMITHS')).toBe(false);
  });

  it('rejects wrong lengths and non-alphanumerics', () => {
    expect(isDealNumberCode('AB12C')).toBe(false);
    expect(isDealNumberCode('AB12CD3')).toBe(false);
    expect(isDealNumberCode('AB-2CD')).toBe(false);
    expect(isDealNumberCode('')).toBe(false);
  });
});
