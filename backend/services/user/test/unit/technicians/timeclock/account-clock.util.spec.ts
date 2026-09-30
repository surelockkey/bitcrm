import {
  accountDay,
  accountMonth,
  dayStartUtc,
  daysInclusive,
  isDay,
  monthsCovering,
  shiftDay,
} from '../../../../src/technicians/timeclock/account-clock.util';

describe('account clock (America/New_York)', () => {
  it('reads an instant as the Eastern day, not the UTC one', () => {
    // 23:30 in Dallas = 00:30 Eastern next day; 03:59Z is still the evening before in New York.
    expect(accountDay('2026-09-28T03:59:59.999Z')).toBe('2026-09-27');
    expect(accountDay('2026-09-28T04:00:00.000Z')).toBe('2026-09-28');
    expect(accountMonth('2026-10-01T02:30:00.000Z')).toBe('2026-09');
  });

  it('starts a day at local midnight on both sides of a clock change', () => {
    expect(dayStartUtc('2026-09-01')).toBe('2026-09-01T04:00:00.000Z'); // EDT
    expect(dayStartUtc('2026-12-01')).toBe('2026-12-01T05:00:00.000Z'); // EST
    expect(dayStartUtc('2026-03-08')).toBe('2026-03-08T05:00:00.000Z'); // spring-forward day starts in EST
    expect(dayStartUtc('2026-03-09')).toBe('2026-03-09T04:00:00.000Z');
    expect(dayStartUtc('2026-11-01')).toBe('2026-11-01T04:00:00.000Z'); // fall-back day starts in EDT
    expect(dayStartUtc('2026-11-02')).toBe('2026-11-02T05:00:00.000Z');
  });

  it('counts, shifts and lists days and months', () => {
    expect(isDay('2026-09-01')).toBe(true);
    expect(isDay('2026-9-1')).toBe(false);
    expect(isDay(undefined)).toBe(false);
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(daysInclusive('2026-09-01', '2026-09-27')).toBe(27);
    expect(monthsCovering('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsCovering('2026-09-01', '2026-09-27')).toEqual(['2026-09']);
  });

  it('has no day for an unreadable instant', () => {
    expect(accountDay('nope')).toBeUndefined();
  });
});
