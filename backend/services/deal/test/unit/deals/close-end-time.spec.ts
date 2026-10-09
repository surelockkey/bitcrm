import { closeEndPatch, closeEndApplied } from 'src/deals/close-end-time';

/**
 * Workiz "Update Job End Time": a job marked Done or Canceled ends at that
 * moment. Its export shows the rule literally — HU142T started 2018-06-07
 * 15:01 and "ended" 2018-07-19 13:50:47, the second its status changed, and
 * 271 of 367k closed jobs even end before they start. The start never moves.
 *
 * Our visit is a wall-clock day + slot in the job's zone, plus the instants
 * an imported job carries, so the patch is the end day, the slot's end, and
 * `jobEndDateUtc` — which is what the EndIndex (the "Job end date" reports)
 * is computed from.
 */
describe('closeEndPatch — where a closed job ends', () => {
  const visit = { scheduledDate: '2026-04-20', scheduledEndDate: '2026-04-20', scheduledTimeSlot: '09:00-12:00' };

  it('moves the end to the closing moment on the job\'s clock, and records which clock that was', () => {
    // 18:30Z = 14:30 in Connecticut.
    expect(closeEndPatch(visit, '2026-04-20T18:30:00.000Z', 'America/New_York')).toEqual({
      scheduledEndDate: '2026-04-20',
      scheduledTimeSlot: '09:00-14:30',
      jobEndDateUtc: '2026-04-20T18:30:00.000Z',
      jobTimezone: 'America/New_York',
    });
  });

  it('the job\'s own zone (an imported job) wins over its area\'s, and is not written again', () => {
    expect(closeEndPatch({ ...visit, jobTimezone: 'America/Chicago' }, '2026-04-20T18:30:00.000Z', 'America/New_York')).toEqual({
      scheduledEndDate: '2026-04-20',
      scheduledTimeSlot: '09:00-13:30',
      jobEndDateUtc: '2026-04-20T18:30:00.000Z',
    });
  });

  it('falls back to the account\'s clock when neither the job nor its area has one', () => {
    expect(closeEndPatch(visit, '2026-04-20T18:30:00.000Z')).toMatchObject({ scheduledTimeSlot: '09:00-14:30', jobTimezone: 'America/New_York' });
  });

  it('a job closed days later ends that day, its start untouched', () => {
    expect(closeEndPatch(visit, '2026-05-02T13:05:00.000Z', 'America/New_York')).toEqual({
      scheduledEndDate: '2026-05-02',
      scheduledTimeSlot: '09:00-09:05',
      jobEndDateUtc: '2026-05-02T13:05:00.000Z',
      jobTimezone: 'America/New_York',
    });
  });

  it('closed before it started on the same day: the end day is the close day, the time is held at the start (a slot cannot run backwards)', () => {
    // 11:30Z = 07:30 Connecticut, before the 09:00 start.
    expect(closeEndPatch(visit, '2026-04-20T11:30:00.000Z', 'America/New_York')).toMatchObject({
      scheduledEndDate: '2026-04-20',
      scheduledTimeSlot: '09:00-09:00',
    });
  });

  it('closed the day before: the end day is the close day (as Workiz\'s reports show it), the time literal', () => {
    expect(closeEndPatch(visit, '2026-04-19T20:00:00.000Z', 'America/New_York')).toMatchObject({
      scheduledEndDate: '2026-04-19',
      scheduledTimeSlot: '09:00-16:00',
    });
  });

  it('an all-day visit gets the close day and keeps no times', () => {
    expect(closeEndPatch({ scheduledDate: '2026-04-20', allDay: true }, '2026-04-22T18:30:00.000Z', 'America/New_York')).toEqual({
      scheduledEndDate: '2026-04-22',
      jobEndDateUtc: '2026-04-22T18:30:00.000Z',
      jobTimezone: 'America/New_York',
    });
  });

  it('a dated visit without times gets the close day only', () => {
    expect(closeEndPatch({ scheduledDate: '2026-04-20' }, '2026-04-22T18:30:00.000Z', 'America/New_York')).toEqual({
      scheduledEndDate: '2026-04-22',
      jobEndDateUtc: '2026-04-22T18:30:00.000Z',
      jobTimezone: 'America/New_York',
    });
  });

  it('an unscheduled job is not scheduled by closing it: only the end instant is written', () => {
    expect(closeEndPatch({}, '2026-04-22T18:30:00.000Z', 'America/New_York')).toEqual({
      jobEndDateUtc: '2026-04-22T18:30:00.000Z',
      jobTimezone: 'America/New_York',
    });
  });

  it('the end day is the close day on the job\'s clock, not UTC\'s', () => {
    // 03:30Z on the 21st is still 23:30 on the 20th in Connecticut.
    expect(closeEndPatch(visit, '2026-04-21T03:30:00.000Z', 'America/New_York')).toMatchObject({
      scheduledEndDate: '2026-04-20',
      scheduledTimeSlot: '09:00-23:30',
    });
  });
});

describe('closeEndApplied — whether a row already ends at its closing moment', () => {
  const visit = { scheduledDate: '2026-04-20', scheduledEndDate: '2026-04-20', scheduledTimeSlot: '09:00-14:30', jobEndDateUtc: '2026-04-20T18:30:00.000Z', jobTimezone: 'America/New_York' };

  it('is true once the patch is on the row, so a second pass changes nothing', () => {
    expect(closeEndApplied(visit, closeEndPatch(visit, '2026-04-20T18:30:00.000Z', 'America/New_York'))).toBe(true);
  });

  it('is false while any part of the end differs', () => {
    expect(closeEndApplied({ ...visit, scheduledTimeSlot: '09:00-12:00' }, closeEndPatch(visit, '2026-04-20T18:30:00.000Z'))).toBe(false);
    expect(closeEndApplied({ ...visit, jobEndDateUtc: undefined }, closeEndPatch(visit, '2026-04-20T18:30:00.000Z'))).toBe(false);
  });
});
