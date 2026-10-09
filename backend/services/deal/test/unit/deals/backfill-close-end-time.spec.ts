import { planCloseEnd } from '../../../src/scripts/backfill-close-end-time';

/**
 * `backfill:close-end-time`: the jobs closed before the rule existed get
 * their end moved to their closing moment — only the ones BitCRM closed.
 * An imported job carries Workiz's own end (`jobEndDateUtc`), which Workiz
 * already moved when it closed the job there; those are the truth the
 * reports are checked against and are left alone unless `--since` says the
 * job closed here, after the import.
 */
describe('backfill:close-end-time — what each row needs', () => {
  const base = { PK: 'DEAL#d1', SK: 'METADATA', id: 'd1', updatedAt: '2026-09-01T00:00:00.000Z', superStatus: 'done' };
  const visit = { scheduledDate: '2026-04-20', scheduledEndDate: '2026-04-20', scheduledTimeSlot: '09:00-12:00' };

  it('moves a job BitCRM closed to its closing moment and restamps its EndIndex keys', () => {
    expect(planCloseEnd({ ...base, ...visit, closedAt: '2026-04-20T18:30:00.000Z' }, { areaTimezone: 'America/New_York' })).toEqual({
      action: 'set',
      patch: {
        scheduledEndDate: '2026-04-20',
        scheduledTimeSlot: '09:00-14:30',
        jobEndDateUtc: '2026-04-20T18:30:00.000Z',
        jobTimezone: 'America/New_York',
      },
      keys: { GSI7PK: 'END#2026-04', GSI7SK: '2026-04-20T14:30#DEAL#d1' },
    });
  });

  it('leaves an open job, and a closed one without a closing moment, alone', () => {
    expect(planCloseEnd({ ...base, ...visit, superStatus: 'in_progress', closedAt: '2026-04-20T18:30:00.000Z' }, {})).toEqual({ action: 'skip', reason: 'open' });
    expect(planCloseEnd({ ...base, ...visit }, {})).toEqual({ action: 'skip', reason: 'no_closed_at' });
  });

  it('leaves an imported job on the end Workiz gave it', () => {
    const row = { ...base, ...visit, closedAt: '2026-04-20T18:30:00.000Z', jobEndDateUtc: '2026-04-20T16:00:00.000Z', jobTimezone: 'America/New_York' };
    expect(planCloseEnd(row, {})).toEqual({ action: 'skip', reason: 'imported' });
  });

  it('…unless it closed here, after the import (`--since`)', () => {
    const row = { ...base, ...visit, closedAt: '2026-10-01T18:30:00.000Z', jobEndDateUtc: '2026-04-20T16:00:00.000Z', jobTimezone: 'America/Chicago' };
    expect(planCloseEnd(row, { since: '2026-09-23T00:00:00.000Z' })).toMatchObject({
      action: 'set',
      patch: { scheduledEndDate: '2026-10-01', scheduledTimeSlot: '09:00-13:30', jobEndDateUtc: '2026-10-01T18:30:00.000Z' },
    });
    expect(planCloseEnd({ ...row, closedAt: '2026-09-01T18:30:00.000Z' }, { since: '2026-09-23T00:00:00.000Z' })).toEqual({ action: 'skip', reason: 'imported' });
  });

  it('a row already at its closing moment is nothing to do — a second run changes nothing', () => {
    const row = {
      ...base,
      scheduledDate: '2026-04-20',
      scheduledEndDate: '2026-04-20',
      scheduledTimeSlot: '09:00-14:30',
      closedAt: '2026-04-20T18:30:00.000Z',
      jobEndDateUtc: '2026-04-20T18:30:00.000Z',
      jobTimezone: 'America/New_York',
      GSI7PK: 'END#2026-04',
      GSI7SK: '2026-04-20T14:30#DEAL#d1',
    };
    expect(planCloseEnd(row, { since: '2026-01-01T00:00:00.000Z' })).toEqual({ action: 'skip', reason: 'same' });
  });

  it('an unscheduled closed job gets its end instant and its keys, and no dates', () => {
    expect(planCloseEnd({ ...base, closedAt: '2026-04-22T18:30:00.000Z' }, { areaTimezone: 'America/New_York' })).toEqual({
      action: 'set',
      patch: { jobEndDateUtc: '2026-04-22T18:30:00.000Z', jobTimezone: 'America/New_York' },
      keys: { GSI7PK: 'END#2026-04', GSI7SK: '2026-04-22T14:30#DEAL#d1' },
    });
  });
});
