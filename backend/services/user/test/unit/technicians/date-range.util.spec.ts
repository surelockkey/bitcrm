import { toRangeStart, toRangeEnd } from '../../../src/technicians/date-range.util';

describe('date-range util', () => {
  it('widens a bare date into the whole UTC day', () => {
    expect(toRangeStart('2026-09-17')).toBe('2026-09-17T00:00:00.000Z');
    expect(toRangeEnd('2026-09-17')).toBe('2026-09-17T23:59:59.999Z');
  });

  it('leaves a full instant alone — a caller that asked for 09:00 means 09:00', () => {
    expect(toRangeStart('2026-09-17T09:00:00.000Z')).toBe('2026-09-17T09:00:00.000Z');
    expect(toRangeEnd('2026-09-17T17:30:00.000Z')).toBe('2026-09-17T17:30:00.000Z');
  });

  // Lexical order on these strings has to equal chronological order, because
  // that is the only reason a BETWEEN on the sort key returns the right rows.
  it('keeps the day boundaries in sort order', () => {
    expect(toRangeStart('2026-09-17') < toRangeEnd('2026-09-17')).toBe(true);
    expect(toRangeEnd('2026-09-17') < toRangeStart('2026-09-18')).toBe(true);
  });
});
