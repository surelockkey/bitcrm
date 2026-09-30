import { BadRequestException } from '@nestjs/common';
import {
  parseTimesheetEntriesQuery,
  parseTimesheetReportQuery,
} from '../../../../../src/technicians/timeclock/report/timesheet-report.query';

describe('Timesheets report query', () => {
  it('opens on User, descending, ten to a page — Workiz\'s defaults', () => {
    expect(parseTimesheetReportQuery({ from: '2026-09-28', to: '2026-09-30' })).toEqual({
      from: '2026-09-28',
      to: '2026-09-30',
      filters: {},
      q: '',
      sort: 'name',
      dir: 'desc',
      page: 1,
      pageSize: 10,
    });
  });

  it('reads the Team and Jobs groups, comma-separated or repeated', () => {
    const q = parseTimesheetReportQuery({
      from: '2026-09-01',
      to: '2026-09-27',
      userId: ['u1,u2', 'u2'],
      job: 'with_job',
      q: '  Ray ',
      sort: 'hours',
      dir: 'asc',
      page: '2',
      pageSize: '25',
    });
    expect(q.filters).toEqual({ userId: ['u1', 'u2'], job: ['with_job'] });
    expect(q).toMatchObject({ q: 'Ray', sort: 'hours', dir: 'asc', page: 2, pageSize: 25 });
  });

  it('takes a single day when `to` is left out', () => {
    expect(parseTimesheetReportQuery({ from: '2026-09-28' })).toMatchObject({ from: '2026-09-28', to: '2026-09-28' });
  });

  it.each([
    [{}, 'from must be a YYYY-MM-DD date'],
    [{ from: '2026-09-30', to: '2026-09-01' }, 'to is before from'],
    [{ from: '2025-01-01', to: '2026-01-02' }, 'The period is at most 366 days'],
    [{ from: '2026-09-01', job: 'maybe' }, 'job must be with_job or without_job'],
    [{ from: '2026-09-01', sort: 'total_time' }, 'sort must be one of name, hours, cost, jobs'],
    [{ from: '2026-09-01', dir: 'up' }, 'dir must be asc or desc'],
    [{ from: '2026-09-01', pageSize: '5000' }, 'pageSize must be 1–1000'],
    [{ from: '2026-09-01', userId: 'bad id!' }, 'userId: "bad id!" is not an id'],
  ])('refuses %p', (raw, message) => {
    expect(() => parseTimesheetReportQuery(raw as never)).toThrow(new BadRequestException(message));
  });

  it('needs whose entries for the opened row', () => {
    expect(() => parseTimesheetEntriesQuery({ from: '2026-09-01' })).toThrow('userId is required');
    expect(parseTimesheetEntriesQuery({ userId: 'u1', from: '2026-09-01', to: '2026-09-27', job: 'without_job' })).toEqual({
      userId: 'u1',
      from: '2026-09-01',
      to: '2026-09-27',
      job: ['without_job'],
    });
  });
});
