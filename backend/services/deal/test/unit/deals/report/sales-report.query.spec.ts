import { BadRequestException } from '@nestjs/common';
import { parseSalesReportQuery, type SalesReportQueryDto } from 'src/deals/report/sales-report.query';

const parse = (q: Record<string, unknown>) => parseSalesReportQuery(q as SalesReportQueryDto);

describe('parseSalesReportQuery', () => {
  it('Workiz\'s defaults: Job ID newest first, 10 rows a page, "By:" left to the account', () => {
    expect(parse({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      by: undefined,
      from: '2026-09-01',
      to: '2026-09-30',
      filters: {},
      q: '',
      sort: 'jobNumber',
      dir: 'desc',
      page: 1,
      pageSize: 10,
      columns: undefined,
    });
  });

  it('reads the six filter groups, comma-separated or repeated', () => {
    const q = parse({
      by: 'end',
      from: '2026-09-01',
      to: '2026-09-27',
      status: 'done,pending',
      techId: ['t1', 't2'],
      jobTypeId: 'jt',
      paymentStatus: 'paid,partly_paid',
      sourceId: 's',
      serviceAreaId: 'a',
    });
    expect(q.by).toBe('end');
    expect(q.filters).toEqual({
      status: ['done', 'pending'],
      techId: ['t1', 't2'],
      jobTypeId: ['jt'],
      paymentStatus: ['paid', 'partly_paid'],
      sourceId: ['s'],
      serviceAreaId: ['a'],
    });
  });

  it('keeps the columns in the report order, whatever order they were asked in', () => {
    expect(parse({ from: '2026-09-01', columns: 'profit,jobNumber,total' }).columns).toEqual(['jobNumber', 'total', 'profit']);
  });

  it.each([
    [{ from: '2026-09-01', paymentStatus: 'overdue' }, /paymentStatus/],
    [{ from: '2026-09-01', sort: 'nope' }, /sort/],
    [{ from: '2026-09-01', columns: 'nope' }, /columns/],
    [{ from: '2026-09-01', by: 'firstPayment' }, /by must be one of/],
    [{ from: '2026-09-30', to: '2026-09-01' }, /before/],
    [{ from: '2025-01-01', to: '2026-09-01' }, /at most 366 days/],
    [{ from: '2026-09-01', status: 'done:sub:x' }, /status/],
    [{ from: '2026-09-01', pageSize: '5000' }, /pageSize/],
    [{}, /from/],
  ])('refuses %j', (q, message) => {
    expect(() => parse(q)).toThrow(BadRequestException);
    expect(() => parse(q)).toThrow(message);
  });
});
