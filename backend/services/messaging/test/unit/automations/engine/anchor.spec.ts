import { anchorInstant, dueInstant, wallClockToUtc } from '../../../../src/automations/engine/anchor';
import { type AutomationDealFacts } from '../../../../src/automations/engine/facts';

const deal: AutomationDealFacts = {
  id: 'd1',
  scheduledDate: '2026-09-20',
  scheduledEndDate: '2026-09-21',
  scheduledTimeSlot: '09:00-11:00',
  statusChangedAt: '2026-09-16T14:00:00.000Z',
  createdAt: '2026-09-10T08:00:00.000Z',
};

describe('wallClockToUtc', () => {
  it('reads a job date and time in the job\'s own zone', () => {
    expect(wallClockToUtc('2026-09-20', '09:00', 'America/New_York')?.toISOString()).toBe('2026-09-20T13:00:00.000Z');
    expect(wallClockToUtc('2026-09-20', '09:00', 'America/Los_Angeles')?.toISOString()).toBe('2026-09-20T16:00:00.000Z');
  });

  it('follows the zone across a DST boundary', () => {
    // EDT (UTC-4) before 1 Nov 2026, EST (UTC-5) after.
    expect(wallClockToUtc('2026-10-31', '09:00', 'America/New_York')?.toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(wallClockToUtc('2026-11-02', '09:00', 'America/New_York')?.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('treats a missing time as midnight and refuses a non-date', () => {
    expect(wallClockToUtc('2026-09-20', undefined, 'America/New_York')?.toISOString()).toBe('2026-09-20T04:00:00.000Z');
    expect(wallClockToUtc('not-a-date', '09:00', 'America/New_York')).toBeUndefined();
  });
});

describe('anchorInstant', () => {
  it('reads each anchor off the job', () => {
    const tz = 'America/New_York';
    expect(anchorInstant({ kind: 'schedule.relative', anchor: 'scheduledStart' }, deal, tz)?.toISOString()).toBe(
      '2026-09-20T13:00:00.000Z',
    );
    expect(anchorInstant({ kind: 'schedule.relative', anchor: 'scheduledEnd' }, deal, tz)?.toISOString()).toBe(
      '2026-09-21T15:00:00.000Z',
    );
    expect(anchorInstant({ kind: 'schedule.relative', anchor: 'statusChangedAt' }, deal, tz)?.toISOString()).toBe(
      '2026-09-16T14:00:00.000Z',
    );
    expect(anchorInstant({ kind: 'schedule.relative', anchor: 'createdAt' }, deal, tz)?.toISOString()).toBe(
      '2026-09-10T08:00:00.000Z',
    );
  });

  it('an unscheduled job anchors nothing', () => {
    expect(anchorInstant({ kind: 'schedule.relative' }, { id: 'd2' }, 'America/New_York')).toBeUndefined();
  });
});

describe('dueInstant', () => {
  it('applies the offset, negative being "before"', () => {
    const before = dueInstant(
      { kind: 'schedule.relative', anchor: 'scheduledStart', offsetMinutes: -60 },
      deal,
      'America/New_York',
    );
    expect(before?.dueAt.toISOString()).toBe('2026-09-20T12:00:00.000Z');
    expect(before?.anchorAt.toISOString()).toBe('2026-09-20T13:00:00.000Z');

    const after = dueInstant(
      { kind: 'schedule.relative', anchor: 'statusChangedAt', offsetMinutes: 1440 },
      deal,
      'America/New_York',
    );
    expect(after?.dueAt.toISOString()).toBe('2026-09-17T14:00:00.000Z');
  });
});
