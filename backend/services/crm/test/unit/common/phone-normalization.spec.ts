import { BadRequestException } from '@nestjs/common';
import {
  normalizePhone,
  normalizePhones,
  formatPhoneDisplay,
} from 'src/common/phone-normalization.util';

describe('normalizePhone', () => {
  it('should normalize 10-digit number with formatting', () => {
    expect(normalizePhone('(404) 555-1234')).toBe('+14045551234');
  });

  it('should normalize plain 10-digit number', () => {
    expect(normalizePhone('4045551234')).toBe('+14045551234');
  });

  it('should normalize 11-digit number starting with 1', () => {
    expect(normalizePhone('14045551234')).toBe('+14045551234');
  });

  it('should keep already-normalized E.164 number', () => {
    expect(normalizePhone('+14045551234')).toBe('+14045551234');
  });

  it('should normalize number with dashes', () => {
    expect(normalizePhone('404-555-1234')).toBe('+14045551234');
  });

  it('should normalize number with dots', () => {
    expect(normalizePhone('404.555.1234')).toBe('+14045551234');
  });

  it('should normalize number with spaces', () => {
    expect(normalizePhone('404 555 1234')).toBe('+14045551234');
  });

  it('should handle international number (non-US)', () => {
    expect(normalizePhone('+380501234567')).toBe('+380501234567');
  });

  it('should throw on too-short number', () => {
    expect(() => normalizePhone('123')).toThrow(BadRequestException);
  });

  it('should throw on empty string', () => {
    expect(() => normalizePhone('')).toThrow(BadRequestException);
  });

  it('should throw on number with too many digits', () => {
    expect(() => normalizePhone('1234567890123456')).toThrow(
      BadRequestException,
    );
  });
});

describe('normalizePhones', () => {
  it('should normalize an array of phones', () => {
    const result = normalizePhones([
      '(404) 555-1234',
      '555-867-5309',
    ]);
    expect(result).toEqual(['+14045551234', '+15558675309']);
  });

  it('should return empty array for empty input', () => {
    expect(normalizePhones([])).toEqual([]);
  });
});

describe('formatPhoneDisplay', () => {
  it('should format US number for display', () => {
    expect(formatPhoneDisplay('+14045551234')).toBe('(404) 555-1234');
  });

  it('should return non-US numbers as-is', () => {
    expect(formatPhoneDisplay('+380501234567')).toBe('+380501234567');
  });
});
