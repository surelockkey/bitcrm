import { BadRequestException } from '@nestjs/common';
import { parseItemsReportQuery } from 'src/deals/report/items-report.query';

describe('parseItemsReportQuery', () => {
  it("defaults: one day, Workiz's item_id desc, page 1 of 50", () => {
    expect(parseItemsReportQuery({ from: '2026-09-01' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-01',
      filters: {},
      q: '',
      sort: 'number',
      dir: 'desc',
      page: 1,
      pageSize: 50,
    });
  });

  it('reads the four filter groups, comma-separated or repeated', () => {
    const q = parseItemsReportQuery({
      from: '2026-09-01',
      to: '2026-09-27',
      type: 'Product,service',
      jobTypeId: ['jt1', 'jt2'],
      category: ['Locks, Keys', 'Safes'],
      soldBy: 'u1,u2',
      item: 'p-1',
      sort: 'price',
      dir: 'asc',
      page: '2',
      pageSize: '100',
      q: '  norton ',
    });
    expect(q.filters).toEqual({
      type: ['product', 'service'],
      jobTypeId: ['jt1', 'jt2'],
      category: ['Locks, Keys', 'Safes'],
      soldBy: ['u1', 'u2'],
    });
    expect(q).toMatchObject({ item: 'p-1', sort: 'price', dir: 'asc', page: 2, pageSize: 100, q: 'norton' });
  });

  it('a single category is one name', () => {
    expect(parseItemsReportQuery({ from: '2026-09-01', category: "Platinum Client's" }).filters.category).toEqual(["Platinum Client's"]);
  });

  it.each([
    [{ from: '2026-9-1' }, /from/],
    [{ from: '2026-09-10', to: '2026-09-01' }, /before/],
    [{ from: '2025-01-01', to: '2026-09-01' }, /366/],
    [{ from: '2026-09-01', type: 'gadget' }, /type/],
    [{ from: '2026-09-01', jobTypeId: 'a b' }, /jobTypeId/],
    [{ from: '2026-09-01', soldBy: 'x;y' }, /soldBy/],
    [{ from: '2026-09-01', sort: 'total' }, /sort/],
    [{ from: '2026-09-01', dir: 'up' }, /dir/],
    [{ from: '2026-09-01', page: '0' }, /page/],
    [{ from: '2026-09-01', pageSize: '1001' }, /pageSize/],
  ])('refuses %j', (raw, message) => {
    expect(() => parseItemsReportQuery(raw)).toThrow(BadRequestException);
    expect(() => parseItemsReportQuery(raw)).toThrow(message);
  });
});
