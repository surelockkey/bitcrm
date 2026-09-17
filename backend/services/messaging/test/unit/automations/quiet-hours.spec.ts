import {
  isOutsideWorkingHours,
  isWithinQuietHours,
  localMinutes,
  nextLocalTime,
  quietHoursEnd,
  workingHoursStart,
} from '../../../src/automations/quiet-hours';

// 2026-09-15T02:30:00Z = 22:30 in New York (EDT, UTC-4) on 2026-09-14
const NY_2230 = new Date('2026-09-15T02:30:00.000Z');
// 2026-09-15T14:00:00Z = 10:00 in New York
const NY_1000 = new Date('2026-09-15T14:00:00.000Z');
const ny = (from: string, to: string) => ({ from, to, timezone: 'America/New_York' });

describe('quiet hours', () => {
  it('reads the local wall clock of the settings zone', () => {
    expect(localMinutes(NY_2230, 'America/New_York')).toBe(22 * 60 + 30);
    expect(localMinutes(NY_2230, 'UTC')).toBe(2 * 60 + 30);
    // midnight is 0, never 24
    expect(localMinutes(new Date('2026-09-15T04:00:00.000Z'), 'America/New_York')).toBe(0);
  });

  it('holds inside a window that wraps midnight and lets the day through', () => {
    expect(isWithinQuietHours(ny('20:00', '08:00'), NY_2230)).toBe(true);
    expect(isWithinQuietHours(ny('20:00', '08:00'), NY_1000)).toBe(false);
    // 07:59 local is still quiet, 08:00 is not
    expect(isWithinQuietHours(ny('20:00', '08:00'), new Date('2026-09-15T11:59:00.000Z'))).toBe(true);
    expect(isWithinQuietHours(ny('20:00', '08:00'), new Date('2026-09-15T12:00:00.000Z'))).toBe(false);
  });

  it('handles a same-day window', () => {
    expect(isWithinQuietHours(ny('09:00', '11:00'), NY_1000)).toBe(true);
    expect(isWithinQuietHours(ny('11:00', '12:00'), NY_1000)).toBe(false);
  });

  it('never holds without a usable window', () => {
    expect(isWithinQuietHours(undefined, NY_2230)).toBe(false);
    expect(isWithinQuietHours(ny('22:00', '22:00'), NY_2230)).toBe(false);
    expect(isWithinQuietHours(ny('late', '08:00'), NY_2230)).toBe(false);
  });

  it('falls back to the company default zone on an unknown one', () => {
    expect(isWithinQuietHours({ from: '20:00', to: '08:00', timezone: 'Mars/Olympus' }, NY_2230)).toBe(true);
  });
});

describe('releasing a held message', () => {
  it('finds the next instant at a local wall time', () => {
    // 22:30 New York → the next 08:00 local is 12:00 UTC the following day.
    expect(nextLocalTime('08:00', 'America/New_York', NY_2230).toISOString()).toBe('2026-09-15T12:00:00.000Z');
    // 10:00 New York → 12:00 local is two hours away.
    expect(nextLocalTime('12:00', 'America/New_York', NY_1000).toISOString()).toBe('2026-09-15T16:00:00.000Z');
    // The same wall time is a full day away, never "now".
    expect(nextLocalTime('10:00', 'America/New_York', NY_1000).toISOString()).toBe('2026-09-16T14:00:00.000Z');
  });

  it('releases at the end of the window it is inside, and not at all outside one', () => {
    expect(quietHoursEnd(ny('20:00', '08:00'), NY_2230).toISOString()).toBe('2026-09-15T12:00:00.000Z');
    expect(quietHoursEnd(ny('20:00', '08:00'), NY_1000)).toBe(NY_1000);
    expect(quietHoursEnd(undefined, NY_1000)).toBe(NY_1000);
  });
});

describe("a rule's own working hours", () => {
  it('is outside the window only when the clock says so', () => {
    expect(isOutsideWorkingHours({ from: '08:00', to: '18:00' }, 'America/New_York', NY_1000)).toBe(false);
    expect(isOutsideWorkingHours({ from: '08:00', to: '18:00' }, 'America/New_York', NY_2230)).toBe(true);
    expect(isOutsideWorkingHours(undefined, 'America/New_York', NY_2230)).toBe(false);
    expect(isOutsideWorkingHours({ from: '09:00', to: '09:00' }, 'America/New_York', NY_2230)).toBe(false);
  });

  it('opens again at the start of the window', () => {
    expect(workingHoursStart({ from: '08:00', to: '18:00' }, 'America/New_York', NY_2230).toISOString()).toBe(
      '2026-09-15T12:00:00.000Z',
    );
    expect(workingHoursStart({ from: '08:00', to: '18:00' }, 'America/New_York', NY_1000)).toBe(NY_1000);
  });
});
