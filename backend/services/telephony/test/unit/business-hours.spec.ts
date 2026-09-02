import { isWithinBusinessHours } from 'src/voice/business-hours';
import type { HoursNode } from '@bitcrm/types';

/**
 * Getting this wrong sends 9am calls to voicemail, and the failure is
 * invisible until a customer mentions it. Everything is computed in the
 * flow's zone, never the server's.
 */
const weekdays = (open: string, close: string) =>
  [1, 2, 3, 4, 5].map((day) => ({ day, open, close }));

const node = (over: Partial<HoursNode> = {}): HoursNode => ({
  id: 'hours',
  type: 'hours',
  timezone: 'America/New_York',
  windows: weekdays('08:00', '18:00'),
  ...over,
});

/** A moment expressed as UTC, so the test says what it means. */
const at = (iso: string) => new Date(iso);

describe('isWithinBusinessHours', () => {
  it('is open during the window and closed either side of it', () => {
    // Wednesday. 13:00 UTC = 09:00 in New York (EDT).
    expect(isWithinBusinessHours(node(), at('2026-08-19T13:00:00Z'))).toBe(true);
    // 11:00 UTC = 07:00 — before opening.
    expect(isWithinBusinessHours(node(), at('2026-08-19T11:00:00Z'))).toBe(false);
    // 23:00 UTC = 19:00 — after closing.
    expect(isWithinBusinessHours(node(), at('2026-08-19T23:00:00Z'))).toBe(false);
  });

  it('closes at the closing minute, not a minute later', () => {
    // 22:00 UTC = 18:00 exactly.
    expect(isWithinBusinessHours(node(), at('2026-08-19T22:00:00Z'))).toBe(false);
    expect(isWithinBusinessHours(node(), at('2026-08-19T21:59:00Z'))).toBe(true);
  });

  it('is closed on days with no window', () => {
    // Sunday 13:00 UTC.
    expect(isWithinBusinessHours(node(), at('2026-08-16T13:00:00Z'))).toBe(false);
  });

  it('reads the clock in the flow timezone, not the server one', () => {
    // 02:00 UTC on Thursday is still 22:00 Wednesday in New York — closed —
    // while the server's own date has already rolled over.
    const moment = at('2026-08-20T02:00:00Z');
    expect(isWithinBusinessHours(node(), moment)).toBe(false);

    // The same instant in Kyiv is 05:00 Thursday, also closed…
    expect(
      isWithinBusinessHours(node({ timezone: 'Europe/Kyiv' }), moment),
    ).toBe(false);
    // …but 09:00 Kyiv on a Thursday is open, and that is 06:00 UTC.
    expect(
      isWithinBusinessHours(node({ timezone: 'Europe/Kyiv' }), at('2026-08-20T06:00:00Z')),
    ).toBe(true);
  });

  it('follows daylight saving without any arithmetic of its own', () => {
    // 13:00 UTC is 09:00 in New York during EDT…
    expect(isWithinBusinessHours(node(), at('2026-08-19T13:00:00Z'))).toBe(true);
    // …and 08:00 in January, under EST — still open.
    expect(isWithinBusinessHours(node(), at('2026-01-14T13:00:00Z'))).toBe(true);
    // 12:00 UTC in January is 07:00 — closed. In August it would have been 08:00.
    expect(isWithinBusinessHours(node(), at('2026-01-14T12:00:00Z'))).toBe(false);
    expect(isWithinBusinessHours(node(), at('2026-08-19T12:00:00Z'))).toBe(true);
  });

  it('treats a holiday as closed whatever the window says', () => {
    const withHoliday = node({ holidays: ['2026-08-19'] });
    expect(isWithinBusinessHours(withHoliday, at('2026-08-19T13:00:00Z'))).toBe(false);
    // The next day is unaffected.
    expect(isWithinBusinessHours(withHoliday, at('2026-08-20T13:00:00Z'))).toBe(true);
  });

  it('handles a window that runs past midnight', () => {
    // A 22:00–02:00 shift is a real one; treating it as an empty range would
    // silently close the line all night.
    const nightShift = node({ windows: [{ day: 3, open: '22:00', close: '02:00' }] });
    // Wednesday 23:00 New York = Thursday 03:00 UTC.
    expect(isWithinBusinessHours(nightShift, at('2026-08-20T03:00:00Z'))).toBe(true);
    // Wednesday 21:00 New York — not yet.
    expect(isWithinBusinessHours(nightShift, at('2026-08-20T01:00:00Z'))).toBe(false);
  });

  it('is closed rather than guessing when the config is unusable', () => {
    expect(isWithinBusinessHours(node({ windows: [] }), at('2026-08-19T13:00:00Z'))).toBe(false);
    expect(
      isWithinBusinessHours(node({ timezone: 'Mars/Olympus' }), at('2026-08-19T13:00:00Z')),
    ).toBe(false);
    expect(
      isWithinBusinessHours(
        node({ windows: [{ day: 3, open: 'nonsense', close: '18:00' }] }),
        at('2026-08-19T13:00:00Z'),
      ),
    ).toBe(false);
  });
});
