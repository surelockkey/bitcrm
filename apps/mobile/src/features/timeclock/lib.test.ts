import type { QueueRecord } from '../../lib/queue/types';
import {
  canClockOut,
  clockDealId,
  clockStartedAt,
  dayIsoOf,
  dayRange,
  deriveClockState,
  describeEntry,
  elapsedMs,
  entriesOnDay,
  entryMinutes,
  failedClockRows,
  formatElapsed,
  formatElapsedShort,
  formatHoursMinutes,
  groupEntriesByDay,
  isOnTheClock,
  secondsUntilCanClockOut,
  spanMs,
  sumFinishedMinutes,
  weekRange,
} from './lib';
import type { TimeClockEntry } from './types';

/** A local wall-clock instant, so these tests do not depend on a timezone. */
const local = (dateIso: string, clock: string): string =>
  new Date(`${dateIso}T${clock}`).toISOString();

const entry = (over: Partial<TimeClockEntry> = {}): TimeClockEntry => ({
  id: 'e1',
  userId: 'tech-1',
  startedAt: local('2026-09-17', '09:03:00'),
  endedAt: local('2026-09-17', '11:47:00'),
  minutes: 164,
  source: 'mobile',
  createdAt: local('2026-09-17', '09:03:00'),
  updatedAt: local('2026-09-17', '11:47:00'),
  ...over,
});

const outboxRow = (over: Partial<Extract<QueueRecord, { queue: 'outbox' }>> = {}) =>
  ({
    queue: 'outbox' as const,
    id: 'row-1',
    userId: 'tech-1',
    kind: 'timeclock_in' as const,
    dealId: '',
    payload: JSON.stringify({
      source: 'mobile',
      clientStartedAt: local('2026-09-17', '09:03:00'),
    }),
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    state: 'pending' as const,
    ...over,
  }) as QueueRecord;

describe('elapsed time is subtracted, never accumulated', () => {
  it('is the difference between two instants, however long the phone slept', () => {
    const started = local('2026-09-17', '09:00:00');
    const threeHoursLater = Date.parse(started) + 3 * 3_600_000;
    // The whole point: no ticks happened in between, and the answer is still
    // exactly three hours.
    expect(elapsedMs(started, threeHoursLater)).toBe(3 * 3_600_000);
  });

  it('never runs backwards on a phone whose clock is behind the server’s', () => {
    const started = local('2026-09-17', '09:00:00');
    expect(elapsedMs(started, Date.parse(started) - 60_000)).toBe(0);
  });

  it('answers 0 rather than NaN for a stamp it cannot read', () => {
    expect(elapsedMs('not a date', Date.now())).toBe(0);
    expect(spanMs('not a date', 'nor this')).toBe(0);
  });
});

describe('formatting', () => {
  it('reads as a stopwatch, with the hours always there', () => {
    // "24:05" on its own could be read as twenty-four hours.
    expect(formatElapsed(24 * 60_000 + 5_000)).toBe('0:24:05');
    expect(formatElapsed(3_600_000 + 24 * 60_000 + 5_000)).toBe('1:24:05');
    expect(formatElapsed(-5)).toBe('0:00:00');
  });

  it('drops the seconds where a seconds digit would only flicker', () => {
    expect(formatElapsedShort(3_600_000 + 24 * 60_000 + 59_000)).toBe('1:24');
  });

  it('says a total the way a technician says it', () => {
    expect(formatHoursMinutes(0)).toBe('0m');
    expect(formatHoursMinutes(45)).toBe('45m');
    expect(formatHoursMinutes(60)).toBe('1h');
    expect(formatHoursMinutes(465)).toBe('7h 45m');
  });
});

describe('what an entry is worth', () => {
  it('takes the server’s own minutes — that is the number payroll uses', () => {
    expect(entryMinutes(entry({ minutes: 164 }))).toBe(164);
  });

  it('still counts a finished entry the server sent no minutes for', () => {
    // Dropping it would quietly shorten somebody's week.
    expect(entryMinutes(entry({ minutes: undefined }))).toBe(164);
  });

  it('is null while it is still running', () => {
    expect(entryMinutes(entry({ endedAt: undefined, minutes: undefined }))).toBeNull();
  });
});

describe('the sums stay honest', () => {
  it('counts finished entries only — a running one is not a finished one', () => {
    const running = entry({ id: 'e2', endedAt: undefined, minutes: undefined });
    expect(sumFinishedMinutes([entry(), running])).toBe(164);
  });

  it('sums a day and a week from the same rows', () => {
    const rows = [
      entry({ id: 'a', minutes: 60 }),
      entry({
        id: 'b',
        startedAt: local('2026-09-16', '08:00:00'),
        endedAt: local('2026-09-16', '12:00:00'),
        minutes: 240,
      }),
    ];
    expect(sumFinishedMinutes(entriesOnDay(rows, '2026-09-17'))).toBe(60);
    expect(sumFinishedMinutes(rows)).toBe(300);
  });
});

describe('grouping the week', () => {
  it('files an entry under the local day it started on, newest day first', () => {
    const groups = groupEntriesByDay(
      [
        entry({ id: 'a' }),
        entry({
          id: 'b',
          startedAt: local('2026-09-16', '08:00:00'),
          endedAt: local('2026-09-16', '09:00:00'),
          minutes: 60,
        }),
      ],
      '2026-09-17',
    );

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
    expect(groups[0]!.minutes).toBe(164);
    expect(groups[1]!.minutes).toBe(60);
  });

  it('keeps a shift that ran past midnight on the day it began', () => {
    // Splitting it in two would show a technician two short nights instead of
    // one long one, and neither would match what they remember.
    const overnight = entry({
      startedAt: local('2026-09-16', '22:00:00'),
      endedAt: local('2026-09-17', '02:00:00'),
      minutes: 240,
    });
    const groups = groupEntriesByDay([overnight], '2026-09-17');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.dateIso).toBe('2026-09-16');
  });

  it('reads a day off an instant in the phone’s own calendar', () => {
    expect(dayIsoOf(local('2026-09-17', '23:30:00'))).toBe('2026-09-17');
    expect(dayIsoOf('rubbish')).toBe('');
  });
});

describe('describing one entry', () => {
  it('gives wall-clock times, so the technician and the office read the same numbers', () => {
    const line = describeEntry(entry());
    expect(line.running).toBe(false);
    expect(line.span).toContain('–');
    expect(line.length).toBe('2h 44m');
  });

  it('says a running entry is running rather than inventing an end', () => {
    const line = describeEntry(entry({ endedAt: undefined, minutes: undefined }));
    expect(line.running).toBe(true);
    expect(line.span).toContain('now');
    expect(line.length).toBe('Running');
  });
});

describe('ranges', () => {
  it('bounds a local day', () => {
    const { from, to } = dayRange('2026-09-17');
    expect(from).toBe(new Date('2026-09-17T00:00:00').toISOString());
    expect(to).toBe(new Date('2026-09-18T00:00:00').toISOString());
  });

  it('means Monday to Sunday, the same week the web means', () => {
    // `apps/web/features/deals/lib.ts#datePresetRange`. The two clients must
    // not show a technician two different weeks.
    const { from, to } = weekRange('2026-09-17');
    expect(new Date(from).getDay()).toBe(1);
    expect(Date.parse(to) - Date.parse(from)).toBe(7 * 24 * 3_600_000);
    expect(Date.parse(from)).toBeLessThanOrEqual(
      Date.parse(new Date('2026-09-17T00:00:00').toISOString()),
    );
  });

  it('puts a Sunday in the week that is ending, not the one beginning', () => {
    const sunday = '2026-09-20';
    expect(new Date(`${sunday}T00:00:00`).getDay()).toBe(0);
    expect(weekRange(sunday).from).toBe(weekRange('2026-09-17').from);
  });
});

describe('Workiz’s one-minute rule (§1.7)', () => {
  const started = Date.parse(local('2026-09-17', '09:00:00'));

  it('refuses a clock-out inside the first minute', () => {
    expect(canClockOut(started, started + 59_000)).toBe(false);
    expect(secondsUntilCanClockOut(started, started + 59_000)).toBe(1);
  });

  it('allows it on the minute', () => {
    expect(canClockOut(started, started + 60_000)).toBe(true);
    expect(secondsUntilCanClockOut(started, started + 60_000)).toBe(0);
  });
});

describe('deriveClockState — the server and the outbox together', () => {
  it('is off when neither has anything to say', () => {
    expect(deriveClockState(null, [])).toEqual({ status: 'off' });
  });

  it('runs on the server’s stamp once the entry exists', () => {
    const running = entry({ endedAt: undefined, minutes: undefined });
    const state = deriveClockState(running, []);
    expect(state.status).toBe('on');
    expect(clockStartedAt(state)).toBe(running.startedAt);
  });

  it('ignores an entry the server has already closed', () => {
    expect(deriveClockState(entry(), [])).toEqual({ status: 'off' });
  });

  it('runs on the phone’s own stamp while the clock-in is still queued', () => {
    // This is the basement case: `GET /current` cannot answer, and a technician
    // who has tapped "Clock in" must see a clock or they will tap it again.
    const state = deriveClockState(null, [outboxRow()]);
    expect(state.status).toBe('starting');
    expect(clockStartedAt(state)).toBe(local('2026-09-17', '09:03:00'));
    expect(isOnTheClock(state)).toBe(true);
  });

  it('carries the job a queued clock-in was started from', () => {
    const state = deriveClockState(null, [outboxRow({ dealId: 'deal-7' })]);
    expect(clockDealId(state)).toBe('deal-7');
  });

  it('stops the clock the moment a clock-out is queued, before it lands', () => {
    const running = entry({ endedAt: undefined, minutes: undefined });
    const state = deriveClockState(running, [
      outboxRow({
        id: 'row-2',
        kind: 'timeclock_out',
        createdAt: 2,
        payload: JSON.stringify({ clientEndedAt: local('2026-09-17', '11:47:00') }),
      }),
    ]);
    expect(state.status).toBe('stopping');
    expect(isOnTheClock(state)).toBe(false);
    // Nothing ticks while it is stopping: the shift is over as far as the
    // technician is concerned.
    expect(clockStartedAt(state)).toBeNull();
  });

  it('takes the newest queued row when a shift was ended and restarted offline', () => {
    const state = deriveClockState(null, [
      outboxRow({ id: 'row-a', kind: 'timeclock_out', createdAt: 1, payload: '{}' }),
      outboxRow({ id: 'row-b', kind: 'timeclock_in', createdAt: 2 }),
    ]);
    expect(state.status).toBe('starting');
  });

  it('believes a row whose fate nobody knows — the technician tapped it', () => {
    // `unknown` means the app died mid-request. Showing "off the clock" to
    // somebody standing on a job working is the worse of the two guesses.
    const state = deriveClockState(null, [outboxRow({ state: 'unknown' })]);
    expect(state.status).toBe('starting');
  });

  it('does not blink "off" between the row landing and the server answering', () => {
    // The row is marked `done` and the server's entry reaches the cache in two
    // separate steps, and a render can fall between them. A tap in that blink
    // is a second entry on somebody's timesheet.
    const state = deriveClockState(null, [outboxRow({ state: 'done' })]);
    expect(state.status).toBe('starting');
    expect(clockStartedAt(state)).toBe(local('2026-09-17', '09:03:00'));
  });

  it('gives way to the server’s entry the moment it arrives', () => {
    const running = entry({ endedAt: undefined, minutes: undefined });
    const state = deriveClockState(running, [outboxRow({ state: 'done' })]);
    expect(state.status).toBe('on');
    expect(clockStartedAt(state)).toBe(running.startedAt);
  });

  it('does not blink "on" between a clock-out landing and the entry closing', () => {
    const running = entry({ endedAt: undefined, minutes: undefined });
    const state = deriveClockState(running, [
      outboxRow({
        id: 'row-out',
        kind: 'timeclock_out',
        state: 'done',
        createdAt: 5,
        payload: JSON.stringify({ clientEndedAt: local('2026-09-17', '11:47:00') }),
      }),
    ]);
    expect(state.status).toBe('stopping');
  });

  it('is simply off once a landed clock-out and the server agree', () => {
    const state = deriveClockState(null, [
      outboxRow({ id: 'row-out', kind: 'timeclock_out', state: 'done', payload: '{}' }),
    ]);
    expect(state).toEqual({ status: 'off' });
  });

  it('does not keep a clock running on a row the queue gave up on', () => {
    const rows = [outboxRow({ state: 'failed' })];
    expect(deriveClockState(null, rows)).toEqual({ status: 'off' });
    // …but it is surfaced, because those are unrecorded hours.
    expect(failedClockRows(rows)).toHaveLength(1);
  });

  it('pays no attention to a queued photo or another job’s note', () => {
    const noise = [
      outboxRow({ id: 'n1', kind: 'note', payload: JSON.stringify({ note: 'x' }) }),
      {
        queue: 'uploads' as const,
        id: 'u1',
        userId: 'tech-1',
        dealId: 'deal-1',
        localUri: 'file:///x.jpg',
        fileName: 'x.jpg',
        contentType: 'image/jpeg',
        size: null,
        category: null,
        attachmentId: null,
        uploadUrl: null,
        uploadHeaders: null,
        progress: 0,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        state: 'pending' as const,
        createdAt: 5,
      },
    ] as QueueRecord[];
    expect(deriveClockState(null, noise)).toEqual({ status: 'off' });
    expect(failedClockRows(noise)).toHaveLength(0);
  });
});
