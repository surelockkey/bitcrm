import { wallClockInstant, zoneAbbr } from '@bitcrm/types';

/**
 * 2026-10-12: every time shown to a person carries its zone — the web prints
 * Connecticut's (EDT/EST), the technician app, texts, the portal and documents
 * the job's own (a Texas visit is CDT). Shared by the services and the portal.
 */
describe('zone labels', () => {
  it('names the zone at an instant', () => {
    expect(zoneAbbr('2026-10-12T13:34:39Z')).toBe('EDT');
    expect(zoneAbbr('2026-12-01T15:00:00Z')).toBe('EST');
    expect(zoneAbbr(new Date('2026-10-12T13:34:39Z'), 'America/Chicago')).toBe('CDT');
    expect(zoneAbbr('2026-10-12T13:34:39Z', 'America/Phoenix')).toBe('MST');
  });

  it('an unreadable instant has no label', () => {
    expect(zoneAbbr('nope')).toBe('');
    expect(zoneAbbr(undefined)).toBe('');
  });

  it('the instant a stored wall clock is, in its zone — across DST', () => {
    expect(wallClockInstant('2026-10-12', '10:00', 'America/Chicago').toISOString()).toBe(
      '2026-10-12T15:00:00.000Z',
    );
    expect(wallClockInstant('2026-12-01', '10:00', 'America/Chicago').toISOString()).toBe(
      '2026-12-01T16:00:00.000Z',
    );
    expect(zoneAbbr(wallClockInstant('2026-12-01', '10:00', 'America/Chicago'), 'America/Chicago')).toBe('CST');
  });
});
