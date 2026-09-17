import {
  elapsedMs,
  minutesBetween,
  MS_PER_MINUTE,
} from '../../../../src/technicians/timeclock/timeclock.util';

const START = '2026-09-17T08:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

describe('timeclock util', () => {
  it('counts whole minutes for an exact span', () => {
    expect(minutesBetween(START, at(90 * MS_PER_MINUTE))).toBe(90);
  });

  it('rounds to the nearest minute rather than truncating', () => {
    expect(minutesBetween(START, at(4 * MS_PER_MINUTE + 40_000))).toBe(5);
    expect(minutesBetween(START, at(4 * MS_PER_MINUTE + 20_000))).toBe(4);
  });

  // Rounding is for pay; the one-minute rule is decided on raw milliseconds, so
  // a 31-second double-tap can never round its way into a billable minute.
  it('reports a sub-minute span honestly in milliseconds', () => {
    expect(elapsedMs(START, at(31_000))).toBe(31_000);
    expect(minutesBetween(START, at(31_000))).toBe(1);
  });

  it('measures a shift that crosses midnight', () => {
    expect(minutesBetween('2026-09-17T23:30:00.000Z', '2026-09-18T00:15:00.000Z')).toBe(45);
  });

  it('returns a negative span when the stamps are out of order', () => {
    expect(elapsedMs(at(60_000), START)).toBe(-60_000);
  });
});
