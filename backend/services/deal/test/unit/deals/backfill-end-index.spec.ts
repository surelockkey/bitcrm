import { planEndIndex } from '../../../src/scripts/backfill-end-index';

describe('backfill:end-index — what each row needs', () => {
  const base = { PK: 'DEAL#d1', SK: 'METADATA', id: 'd1', updatedAt: '2026-09-01T00:00:00.000Z' };

  it('stamps an imported row that has no keys yet, on the Eastern clock of its end instant', () => {
    expect(
      planEndIndex({
        ...base,
        scheduledDate: '2026-09-24',
        scheduledEndDate: '2026-09-24',
        scheduledTimeSlot: '08:00-12:00',
        jobTimezone: 'America/Chicago',
        jobEndDateUtc: '2026-09-24T17:00:00.000Z',
      }),
    ).toEqual({ action: 'set', pk: 'END#2026-09', sk: '2026-09-24T13:00#DEAL#d1' });
  });

  it('leaves a correctly stamped row alone — a second run changes nothing', () => {
    expect(
      planEndIndex({ ...base, scheduledDate: '2026-09-24', scheduledTimeSlot: '08:00-12:00', GSI7PK: 'END#2026-09', GSI7SK: '2026-09-24T12:00#DEAL#d1' }),
    ).toEqual({ action: 'same' });
  });

  it('re-stamps a row whose keys went stale, and clears keys from a row with no date', () => {
    expect(planEndIndex({ ...base, scheduledDate: '2026-10-01', GSI7PK: 'END#2026-09', GSI7SK: '2026-09-24#DEAL#d1' })).toEqual({
      action: 'set',
      pk: 'END#2026-10',
      sk: '2026-10-01#DEAL#d1',
    });
    expect(planEndIndex({ ...base, GSI7PK: 'END#2026-09', GSI7SK: 'x' })).toEqual({ action: 'remove' });
    expect(planEndIndex({ ...base })).toEqual({ action: 'same' });
  });
});
