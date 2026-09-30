import { BadRequestException } from '@nestjs/common';
import {
  encodeCursor,
  monthsDescending,
  monthsSpanned,
  parseCursor,
  previousMonth,
  walkMonths,
} from 'src/common/utils/month-walk';

/**
 * Обхід місячних партицій від найновішої до найстарішої — спільна машинерія
 * журналу інвентарю і звіту використання: сторінка добирається через межі
 * місяців, як scanPage добирає її між читаннями, у межах бюджету читань.
 */
describe('month walk', () => {
  const page = (items: string[], lastKey?: Record<string, unknown>, reads = 1) => ({ items, lastKey, reads });

  describe('month helpers', () => {
    it('steps back a month across the year boundary', () => {
      expect(previousMonth('2026-03')).toBe('2026-02');
      expect(previousMonth('2026-01')).toBe('2025-12');
    });

    it('lists the months newest first, both ends included', () => {
      expect(monthsDescending('2025-11', '2026-02')).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
      expect(monthsDescending('2026-10', '2026-09')).toEqual([]);
    });

    it('counts the months a window touches arithmetically, both ends included', () => {
      expect(monthsSpanned('2026-09', '2026-09')).toBe(1);
      expect(monthsSpanned('2024-10', '2026-09')).toBe(24);
      expect(monthsSpanned('0001-01', '2026-09')).toBeGreaterThan(24_000);
    });
  });

  describe('walkMonths', () => {
    const months = ['2026-09', '2026-08', '2026-07'];

    it('fills the page across months, asking each only for what is still missing', async () => {
      const read = jest.fn(async (month: string, ..._rest: unknown[]) =>
        month === '2026-09' ? page(['s1', 's2']) : month === '2026-08' ? page(['a1']) : page(['j1'], { SK: 'j1' }),
      );

      const result = await walkMonths(months, read, { limit: 4, maxReads: 20 });

      expect(result.items).toEqual(['s1', 's2', 'a1', 'j1']);
      expect(result.next).toEqual({ month: '2026-07', lastKey: { SK: 'j1' } });
      expect(read.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
        ['2026-09', 4, undefined],
        ['2026-08', 2, undefined],
        ['2026-07', 1, undefined],
      ]);
    });

    it('hands back the position inside the month that filled the page', async () => {
      const read = jest.fn(async (..._args: unknown[]) => page(['s1', 's2'], { PK: 'x', SK: 'k' }));

      const result = await walkMonths(months, read, { limit: 2, maxReads: 20 });

      expect(result.next).toEqual({ month: '2026-09', lastKey: { PK: 'x', SK: 'k' } });
    });

    it('points at the next month when a month ends exactly on the page boundary', async () => {
      const read = jest.fn(async (..._args: unknown[]) => page(['s1', 's2']));

      expect((await walkMonths(months, read, { limit: 2, maxReads: 20 })).next).toEqual({ month: '2026-08' });
      expect((await walkMonths(['2026-07'], read, { limit: 2, maxReads: 20 })).next).toBeUndefined();
    });

    it('resumes in the month and from the key it is given', async () => {
      const read = jest.fn(async (month: string, ..._rest: unknown[]) => (month === '2026-08' ? page(['a2']) : page([])));

      const result = await walkMonths(months, read, {
        limit: 5,
        maxReads: 20,
        start: { month: '2026-08', lastKey: { PK: 'x', SK: 'k' } },
      });

      expect(result.items).toEqual(['a2']);
      expect(read.mock.calls[0].slice(0, 3)).toEqual(['2026-08', 5, { PK: 'x', SK: 'k' }]);
    });

    it('refuses a start month outside the walk (a cursor minted for another window)', async () => {
      const read = jest.fn(async (..._args: unknown[]) => page([]));

      await expect(walkMonths(months, read, { limit: 5, maxReads: 20, start: { month: '2025-01' } })).rejects.toThrow(
        BadRequestException,
      );
      expect(read).not.toHaveBeenCalled();
    });

    it('charges the reads each month reports and hands it only what is left', async () => {
      const read = jest
        .fn()
        .mockResolvedValueOnce(page([], { SK: 'a' }, 15))
        .mockResolvedValueOnce(page(['s1'], { SK: 'b' }, 5));

      const result = await walkMonths(months, read, { limit: 20, maxReads: 20 });

      expect(read.mock.calls.map((c) => c[3])).toEqual([20, 5]);
      expect(result.items).toEqual(['s1']);
      expect(result.next).toEqual({ month: '2026-09', lastKey: { SK: 'b' } });
    });

    it('does not charge an empty month, so a wide empty window never answers an empty page with a cursor', async () => {
      const read = jest.fn(async (month: string, ..._rest: unknown[]) => (month === '2026-09' ? page(['s1']) : page([])));

      const result = await walkMonths(months, read, { limit: 3, maxReads: 2 });

      expect(result.items).toEqual(['s1']);
      expect(result.next).toBeUndefined();
      expect(read).toHaveBeenCalledTimes(3);
    });
  });

  describe('cursor codec', () => {
    it('round-trips an object through base64url JSON', () => {
      const cursor = encodeCursor({ month: '2026-09', lastKey: { PK: 'x' } });
      expect(parseCursor(cursor)).toEqual({ month: '2026-09', lastKey: { PK: 'x' } });
    });

    it('is a 400 for anything it did not mint', () => {
      expect(() => parseCursor('garbage')).toThrow('Invalid cursor');
      expect(() => parseCursor(Buffer.from('"text"').toString('base64url'))).toThrow(BadRequestException);
      expect(() => parseCursor(Buffer.from('null').toString('base64url'))).toThrow(BadRequestException);
    });
  });
});
