import {
  createdAt,
  dayOf,
  dayStartUtc,
  jobEndAt,
  jobStartAt,
  reportDay,
  shiftDay,
  wallClock,
} from 'src/deals/report/report-dates';

describe('report dates — the account calendar (America/New_York)', () => {
  it('reads an instant on the Eastern wall clock, across both clock changes', () => {
    expect(wallClock('2026-09-24T13:00:00.000Z')).toBe('2026-09-24T09:00'); // EDT, −4
    expect(wallClock('2026-01-15T13:00:00.000Z')).toBe('2026-01-15T08:00'); // EST, −5
    // 2026-03-08 02:00 EST → 03:00 EDT: 06:59Z is 01:59, 07:00Z is 03:00.
    expect(wallClock('2026-03-08T06:59:00.000Z')).toBe('2026-03-08T01:59');
    expect(wallClock('2026-03-08T07:00:00.000Z')).toBe('2026-03-08T03:00');
    // 2026-11-01 02:00 EDT → 01:00 EST.
    expect(wallClock('2026-11-01T05:30:00.000Z')).toBe('2026-11-01T01:30');
    expect(wallClock('2026-11-01T06:30:00.000Z')).toBe('2026-11-01T01:30');
  });

  it('reads other zones too, and falls back to the account zone for an unknown one', () => {
    expect(wallClock('2026-09-25T04:30:00.000Z', 'America/Chicago')).toBe('2026-09-24T23:30');
    expect(wallClock('2026-09-25T04:30:00.000Z', 'Not/AZone')).toBe('2026-09-25T00:30');
    expect(wallClock(undefined)).toBeUndefined();
    expect(wallClock('not a date')).toBeUndefined();
  });

  it('knows where an Eastern day begins in UTC', () => {
    expect(dayStartUtc('2026-09-01')).toBe('2026-09-01T04:00:00.000Z');
    expect(dayStartUtc('2026-01-01')).toBe('2026-01-01T05:00:00.000Z');
    expect(dayStartUtc('2026-03-08')).toBe('2026-03-08T05:00:00.000Z');
    expect(dayStartUtc('2026-03-09')).toBe('2026-03-09T04:00:00.000Z');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayOf('2026-09-28T03:59:59.999Z')).toBe('2026-09-27');
  });

  it('reports creation on the Eastern day, not the UTC one', () => {
    const late = { createdAt: '2026-09-28T02:13:34.000Z' };
    expect(createdAt(late)).toBe('2026-09-27T22:13');
    expect(reportDay(late, 'created')).toBe('2026-09-27');
  });

  describe('an imported job', () => {
    // Workiz job 63067396: Dallas-area visit 08:00–12:00 Central on 2026-09-24.
    const dallas = {
      createdAt: '2026-08-03T21:43:40.000Z',
      scheduledDate: '2026-09-24',
      scheduledEndDate: '2026-09-24',
      scheduledTimeSlot: '08:00-12:00',
      jobTimezone: 'America/Chicago',
      jobDateUtc: '2026-09-24T13:00:00.000Z',
      jobEndDateUtc: '2026-09-24T17:00:00.000Z',
    };

    it('reports the visit on the Eastern clock from the instants Workiz held', () => {
      expect(jobStartAt(dallas)).toBe('2026-09-24T09:00');
      expect(jobEndAt(dallas)).toBe('2026-09-24T13:00');
    });

    it('moves a late Central visit onto the next Eastern day, as Workiz does', () => {
      const late = {
        ...dallas,
        scheduledTimeSlot: '23:30-23:45',
        jobDateUtc: '2026-09-25T04:30:00.000Z',
        jobEndDateUtc: '2026-09-25T04:45:00.000Z',
      };
      expect(reportDay(late, 'scheduled')).toBe('2026-09-25');
      expect(reportDay(late, 'end')).toBe('2026-09-25');
    });

    it('stops trusting the instants once the job is rescheduled here', () => {
      const moved = { ...dallas, scheduledDate: '2026-10-02', scheduledEndDate: '2026-10-02', scheduledTimeSlot: '10:00-11:00' };
      expect(jobStartAt(moved)).toBe('2026-10-02T10:00');
      expect(jobEndAt(moved)).toBe('2026-10-02T11:00');
    });

    it('uses the end instant alone when the row has no scheduled days', () => {
      expect(jobEndAt({ createdAt: '2018-01-01T00:00:00.000Z', jobEndDateUtc: '2018-02-01T15:00:00.000Z' })).toBe('2018-02-01T10:00');
    });
  });

  describe('a job created in BitCRM', () => {
    it('reports the booked slot as entered', () => {
      const d = { createdAt: '2026-09-01T12:00:00.000Z', scheduledDate: '2026-09-03', scheduledTimeSlot: '09:00-12:00' };
      expect(jobStartAt(d)).toBe('2026-09-03T09:00');
      expect(jobEndAt(d)).toBe('2026-09-03T12:00');
    });

    it('ends a multi-day visit on its end date', () => {
      const d = { scheduledDate: '2026-09-03', scheduledEndDate: '2026-09-05', scheduledTimeSlot: '09:00-12:00' };
      expect(reportDay(d, 'scheduled')).toBe('2026-09-03');
      expect(reportDay(d, 'end')).toBe('2026-09-05');
    });

    it('drops the time of an all-day visit or of a slot that is not HH:MM', () => {
      expect(jobStartAt({ scheduledDate: '2026-09-03', scheduledTimeSlot: '09:00-12:00', allDay: true })).toBe('2026-09-03');
      expect(jobEndAt({ scheduledDate: '2026-09-03', scheduledTimeSlot: 'morning' })).toBe('2026-09-03');
    });

    it('reports an unscheduled job on its hidden one-hour slot from creation', () => {
      const d = { createdAt: '2026-09-28T03:30:00.000Z' }; // 23:30 Eastern on the 27th
      expect(jobStartAt(d)).toBe('2026-09-27T23:30');
      expect(jobEndAt(d)).toBe('2026-09-28T00:30');
    });

    it('has no dates at all without a creation stamp', () => {
      expect(jobStartAt({})).toBeUndefined();
      expect(jobEndAt({})).toBeUndefined();
    });
  });
});
