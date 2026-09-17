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

  // A payroll week for a US account arrives as local midnight with an offset.
  // Used verbatim it is a bound in a different dialect from the rows it is
  // compared against, and lexical BETWEEN gives the wrong week's hours.
  it('restamps an offset instant as the UTC instant it names', () => {
    expect(toRangeStart('2026-09-17T00:00:00-04:00')).toBe('2026-09-17T04:00:00.000Z');
    expect(toRangeEnd('2026-09-18T00:00:00-04:00')).toBe('2026-09-18T04:00:00.000Z');
    expect(toRangeStart('2026-09-17T09:00:00+03:00')).toBe('2026-09-17T06:00:00.000Z');
  });

  // The whole point: a bound must sort against stored `...000Z` keys the way
  // the clock says it should.
  it('puts an offset bound on the right side of the rows it brackets', () => {
    const lo = `CLOCK#${toRangeStart('2026-09-17T00:00:00-04:00')}`;
    const hi = `CLOCK#${toRangeEnd('2026-09-18T00:00:00-04:00')}~`;
    const inRange = (sk: string) => sk >= lo && sk <= hi;

    // 22:00 on the 16th, Eastern — the previous working day.
    expect(inRange('CLOCK#2026-09-17T02:00:00.000Z#a')).toBe(false);
    // 09:00 on the 17th, Eastern.
    expect(inRange('CLOCK#2026-09-17T13:00:00.000Z#b')).toBe(true);
    // 22:00 on the 17th, Eastern — a late call-out, still that day's pay.
    expect(inRange('CLOCK#2026-09-18T02:00:00.000Z#c')).toBe(true);
  });

  it('reads a zone-less instant as UTC, so the answer does not move with the host', () => {
    expect(toRangeStart('2026-09-17T09:00:00')).toBe('2026-09-17T09:00:00.000Z');
    expect(toRangeEnd('2026-09-17T17:30:00.500')).toBe('2026-09-17T17:30:00.500Z');
  });

  it('normalises a second-precision instant to the millisecond form rows use', () => {
    expect(toRangeStart('2026-09-17T09:00:00Z')).toBe('2026-09-17T09:00:00.000Z');
  });
});
