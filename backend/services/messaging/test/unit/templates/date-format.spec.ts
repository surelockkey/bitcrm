import { formatDate, formatTime, resolveTimezone, splitTimeSlot } from '../../../src/templates/date-format';

describe('date-format', () => {
  describe('resolveTimezone', () => {
    it('keeps a valid IANA zone and falls back on anything else', () => {
      expect(resolveTimezone('America/Los_Angeles')).toBe('America/Los_Angeles');
      expect(resolveTimezone('Mars/Olympus')).toBe('America/New_York');
      expect(resolveTimezone(undefined)).toBe('America/New_York');
      expect(resolveTimezone('', 'Europe/Kyiv')).toBe('Europe/Kyiv');
    });
  });

  describe('formatDate', () => {
    it('renders a wall-clock date without shifting it, whatever the zone', () => {
      expect(formatDate('2026-09-15', 'America/New_York')).toBe('Sep 15, 2026');
      expect(formatDate('2026-09-15', 'Pacific/Auckland')).toBe('Sep 15, 2026');
      expect(formatDate('2026-01-01', 'America/Los_Angeles')).toBe('Jan 1, 2026');
    });

    it('renders an instant in the given zone', () => {
      const instant = '2026-09-15T23:30:00.000Z';
      expect(formatDate(instant, 'America/New_York')).toBe('Sep 15, 2026');
      expect(formatDate(instant, 'Europe/Kyiv')).toBe('Sep 16, 2026');
    });

    it('is undefined for nothing or garbage', () => {
      expect(formatDate(undefined, 'UTC')).toBeUndefined();
      expect(formatDate('', 'UTC')).toBeUndefined();
      expect(formatDate('not a date', 'UTC')).toBeUndefined();
    });
  });

  describe('formatTime', () => {
    it('renders HH:MM as 12-hour wall-clock, unshifted', () => {
      expect(formatTime('14:30', 'Pacific/Auckland')).toBe('2:30 PM');
      expect(formatTime('00:05', 'UTC')).toBe('12:05 AM');
      expect(formatTime('12:00', 'UTC')).toBe('12:00 PM');
      expect(formatTime('9:07', 'UTC')).toBe('9:07 AM');
    });

    it('renders an instant in the given zone with a plain space before AM/PM', () => {
      const instant = '2026-09-15T23:30:00.000Z';
      expect(formatTime(instant, 'America/New_York')).toBe('7:30 PM');
      expect(formatTime(instant, 'America/Los_Angeles')).toBe('4:30 PM');
      expect(formatTime(instant, 'Europe/Kyiv')).toBe('2:30 AM');
      expect(formatTime(instant, 'America/New_York')).not.toMatch(/[  ]/);
    });

    it('is undefined for nothing or garbage', () => {
      expect(formatTime(undefined, 'UTC')).toBeUndefined();
      expect(formatTime('25:99', 'UTC')).toBeUndefined();
    });
  });

  it('splits a HH:MM-HH:MM slot', () => {
    expect(splitTimeSlot('09:00-11:30')).toEqual({ start: '09:00', end: '11:30' });
    expect(splitTimeSlot('09:00')).toEqual({ start: '09:00', end: undefined });
    expect(splitTimeSlot(undefined)).toEqual({});
  });
});
