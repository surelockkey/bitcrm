/**
 * `GET /deals/map?statuses=&from=&to=` — what the dispatch map asks for.
 *
 * The board holds every OPEN job whatever its date (Workiz `map/getJobs`), so
 * the open statuses are read whole; Done and Canceled are hundreds of
 * thousands of rows after the import and are only ever read for the date
 * box's days.
 */
import { BadRequestException } from '@nestjs/common';
import { JobSuperStatus } from '@bitcrm/types';
import { DISPATCH_MAP_MAX_DAYS, parseDispatchMapQuery } from 'src/deals/map/dispatch-map.query';

const OPEN = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
];

describe('parseDispatchMapQuery', () => {
  it('asks for the four open statuses when none is named', () => {
    expect(parseDispatchMapQuery({})).toEqual({ statuses: OPEN });
    expect(parseDispatchMapQuery({ statuses: '' })).toEqual({ statuses: OPEN });
  });

  it('takes a comma list, once each, in the board’s status order', () => {
    expect(parseDispatchMapQuery({ statuses: ' pending,submitted,pending ' })).toEqual({
      statuses: [JobSuperStatus.SUBMITTED, JobSuperStatus.PENDING],
    });
  });

  it('takes the list repeated as well (`?statuses=a&statuses=b`)', () => {
    expect(parseDispatchMapQuery({ statuses: ['pending', 'submitted'] }).statuses).toEqual([
      JobSuperStatus.SUBMITTED,
      JobSuperStatus.PENDING,
    ]);
  });

  it('refuses a status that does not exist', () => {
    expect(() => parseDispatchMapQuery({ statuses: 'submitted,lead' })).toThrow(BadRequestException);
  });

  it('reads Done / Canceled only for a window of days', () => {
    expect(() => parseDispatchMapQuery({ statuses: 'done' })).toThrow(BadRequestException);
    expect(parseDispatchMapQuery({ statuses: 'canceled,done', from: '2026-10-11', to: '2026-10-17' })).toEqual({
      statuses: [JobSuperStatus.DONE, JobSuperStatus.CANCELED],
      window: { from: '2026-10-11', to: '2026-10-17' },
    });
  });

  it('a window without `to` is that one day', () => {
    expect(parseDispatchMapQuery({ statuses: 'done', from: '2026-10-12' }).window).toEqual({
      from: '2026-10-12',
      to: '2026-10-12',
    });
  });

  it('keeps a window beside open statuses — it narrows them too (the board reads only the days it shows)', () => {
    expect(parseDispatchMapQuery({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      statuses: OPEN,
      window: { from: '2026-10-01', to: '2026-10-31' },
    });
  });

  it.each([
    ['not a date', { statuses: 'done', from: '10/12/2026' }],
    ['not a real day', { statuses: 'done', from: '2026-02-30' }],
    ['ends before it starts', { statuses: 'done', from: '2026-10-12', to: '2026-10-11' }],
    ['`to` alone', { statuses: 'done', to: '2026-10-12' }],
  ])('refuses a window that is %s', (_why, query) => {
    expect(() => parseDispatchMapQuery(query)).toThrow(BadRequestException);
  });

  it(`refuses a window longer than a month (${DISPATCH_MAP_MAX_DAYS} days) — the date box's widest`, () => {
    expect(DISPATCH_MAP_MAX_DAYS).toBe(31);
    expect(parseDispatchMapQuery({ statuses: 'done', from: '2026-10-01', to: '2026-10-31' }).window).toBeDefined();
    expect(() => parseDispatchMapQuery({ statuses: 'done', from: '2026-10-01', to: '2026-11-01' })).toThrow(
      BadRequestException,
    );
  });
});
