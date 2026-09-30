import { BadRequestException } from '@nestjs/common';
import { parseJobsReportQuery, type JobsReportQueryDto } from 'src/deals/report/jobs-report.query';

const parse = (q: Partial<JobsReportQueryDto>) => parseJobsReportQuery({ from: '2026-09-01', to: '2026-09-27', ...q } as JobsReportQueryDto);

describe('parseJobsReportQuery', () => {
  it('defaults to created desc, page 1 of 50, and leaves By to the account setting', () => {
    expect(parse({})).toEqual({
      by: undefined,
      from: '2026-09-01',
      to: '2026-09-27',
      filters: {},
      q: '',
      sort: 'created',
      dir: 'desc',
      page: 1,
      pageSize: 50,
      columns: undefined,
    });
  });

  it('takes a single day, a year, and refuses anything longer or backwards', () => {
    expect(parse({ to: undefined }).to).toBe('2026-09-01');
    expect(parse({ from: '2024-01-01', to: '2024-12-31' }).to).toBe('2024-12-31'); // a leap year: 366 days
    expect(() => parse({ from: '2025-01-01', to: '2026-01-02' })).toThrow(BadRequestException); // 367 days
    expect(() => parse({ from: '2026-09-27', to: '2026-09-01' })).toThrow('to is before from');
    expect(() => parse({ from: '09/01/2026' })).toThrow('from must be a YYYY-MM-DD date');
  });

  it('reads By, and refuses what Workiz does not have', () => {
    expect(parse({ by: 'end' }).by).toBe('end');
    expect(() => parse({ by: 'closed' })).toThrow(BadRequestException);
  });

  it('reads list filters comma-separated or repeated, deduped', () => {
    const q = parse({
      status: ['done', 'canceled:ss-1,done'],
      techId: 'u1,u2',
      origin: 'lead',
      tagId: ['t1', 't1'],
      serviceAreaId: 'sa1',
      externalCompanyId: 'ec1',
    });
    expect(q.filters).toEqual({
      status: ['done', 'canceled:ss-1'],
      techId: ['u1', 'u2'],
      origin: ['lead'],
      tagId: ['t1'],
      serviceAreaId: ['sa1'],
      externalCompanyId: ['ec1'],
    });
  });

  it('refuses an unknown status, origin, or an id with odd characters', () => {
    expect(() => parse({ status: 'closed' })).toThrow('is not a status');
    expect(() => parse({ status: 'done:a:b' })).toThrow('is not a status');
    expect(() => parse({ origin: 'web' })).toThrow('origin must be lead or new');
    expect(() => parse({ techId: 'a b' })).toThrow('is not an id');
  });

  it('sorts on a known column only and pages up to 1000 rows', () => {
    expect(parse({ sort: 'total', dir: 'asc', page: '3', pageSize: '1000' })).toMatchObject({ sort: 'total', dir: 'asc', page: 3, pageSize: 1000 });
    expect(() => parse({ sort: 'profit' })).toThrow('unknown column');
    expect(() => parse({ dir: 'up' })).toThrow('dir must be asc or desc');
    expect(() => parse({ pageSize: '1001' })).toThrow('pageSize must be 1–1000');
    expect(() => parse({ page: '0' })).toThrow('page must be a positive integer');
  });

  it('puts export columns in the report order, whatever order they came in', () => {
    expect(parse({ columns: 'total,jobNumber,city' }).columns).toEqual(['jobNumber', 'city', 'total']);
    expect(() => parse({ columns: 'jobNumber,secret' })).toThrow('unknown column');
  });
});
