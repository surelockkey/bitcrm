import { walkYears, yearNow } from '../../../src/common/year-walk';

/**
 * The inbox reads INBOX#open#<YYYY> for the current year and, when the page
 * is short, continues into earlier years (design §3.3 A1). These pin the
 * cursor semantics that both the conversations and messages listings use.
 */
describe('walkYears', () => {
  const pages = (byYear: Record<string, { items: string[]; lek?: Record<string, unknown> }>) => {
    const calls: Array<{ year: string; startKey?: Record<string, unknown>; limit: number }> = [];
    const query = async (year: string, startKey: Record<string, unknown> | undefined, limit: number) => {
      calls.push({ year, startKey, limit });
      const page = byYear[year] ?? { items: [] };
      return { items: page.items, lastEvaluatedKey: page.lek };
    };
    return { calls, query };
  };

  it('uses the UTC year of the clock as the first bucket', () => {
    expect(yearNow(new Date('2026-12-31T23:30:00.000Z'))).toBe('2026');
    expect(yearNow(new Date('2027-01-01T00:30:00.000Z'))).toBe('2027');
  });

  it('continues into the previous year when the current one runs dry', async () => {
    const { calls, query } = pages({
      '2026': { items: ['a', 'b'] },
      '2025': { items: ['c', 'd', 'e'], lek: { SK: 'c' } },
    });
    const res = await walkYears({ startYear: '2026', minYear: 2020, limit: 3, query });

    expect(res.items).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(calls).toEqual([
      { year: '2026', startKey: undefined, limit: 3 },
      { year: '2025', startKey: undefined, limit: 1 },
    ]);
    // DynamoDB stopped inside 2025 → resume right there.
    expect(res.nextCursor).toEqual({ y: '2025', k: { SK: 'c' } });
  });

  it('points the cursor at the next year when a year fills the page exactly', async () => {
    const { query } = pages({ '2026': { items: ['a', 'b'] } });
    const res = await walkYears({ startYear: '2026', minYear: 2020, limit: 2, query });
    expect(res.items).toEqual(['a', 'b']);
    expect(res.nextCursor).toEqual({ y: '2025' });
  });

  it('resumes from the cursor year and key', async () => {
    const { calls, query } = pages({ '2025': { items: ['x'] } });
    const res = await walkYears({
      startYear: '2026',
      minYear: 2025,
      limit: 5,
      cursor: { y: '2025', k: { SK: 'c' } },
      query,
    });
    expect(calls).toEqual([{ year: '2025', startKey: { SK: 'c' }, limit: 5 }]);
    expect(res.items).toEqual(['x']);
    expect(res.nextCursor).toBeUndefined();
  });

  it('stops at minYear with no cursor when everything is exhausted', async () => {
    const { calls, query } = pages({});
    const res = await walkYears({ startYear: '2026', minYear: 2024, limit: 10, query });
    expect(res.items).toEqual([]);
    expect(res.nextCursor).toBeUndefined();
    expect(calls.map((c) => c.year)).toEqual(['2026', '2025', '2024']);
  });
});
