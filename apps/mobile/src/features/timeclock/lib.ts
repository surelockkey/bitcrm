import type { OutboxKind, QueueRecord } from '../../lib/queue/types';
import {
  formatDayHeading,
  formatStampTime,
  localDateIso,
  shiftDateIso,
} from '../jobs/lib';
import type { ClockInPayload, ClockOutPayload, TimeClockEntry } from './types';

/**
 * Everything the time clock knows how to work out, with no React and no
 * network in it — so the arithmetic a technician's pay depends on is a test
 * rather than a hope.
 */

/* ---------------------------------------------------------------- elapsed */

/**
 * How long an entry has been running, **computed from its start stamp every
 * time**.
 *
 * Never accumulated in a timer. A phone in a pocket suspends its intervals: a
 * counter that added a second per tick would be minutes short after a job, and
 * would be wrong in the technician's favour on one shift and against them on
 * the next. Subtracting two instants is right however long the phone slept.
 */
export function elapsedMs(startedAt: string, now: number): number {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  // A phone whose clock is behind the server's would otherwise show a negative
  // stopwatch the moment the clock starts.
  return Math.max(0, now - start);
}

/** How long a closed entry ran, from its own two stamps. */
export function spanMs(startedAt: string, endedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The running clock: `H:MM:SS`, hours always present.
 *
 * A stopwatch is the one shape everybody already reads, and `0:24:05` cannot be
 * mistaken for twenty-four hours the way a bare `24:05` can.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  return `${hours}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}

/** `H:MM` — the same clock where a seconds digit would only flicker. */
export function formatElapsedShort(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`;
}

/** A total, said the way a technician says it: "7h 45m", "45m", "0m". */
export function formatHoursMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/* ------------------------------------------------------------- the entries */

export function isRunning(entry: Pick<TimeClockEntry, 'endedAt'>): boolean {
  return !entry.endedAt;
}

/**
 * How many minutes an entry contributes — `null` while it is still running.
 *
 * The server's own `minutes` wins, because that is the number payroll will use.
 * A closed entry that arrives without one is still counted, from its two
 * stamps: dropping it would quietly shorten somebody's week.
 */
export function entryMinutes(
  entry: Pick<TimeClockEntry, 'startedAt' | 'endedAt' | 'minutes'>,
): number | null {
  if (!entry.endedAt) return null;
  if (typeof entry.minutes === 'number' && Number.isFinite(entry.minutes)) {
    return Math.max(0, entry.minutes);
  }
  return Math.round(spanMs(entry.startedAt, entry.endedAt) / 60_000);
}

/**
 * The hours on the screen: **finished entries only**.
 *
 * A running entry is not a finished one. Counting the shift in progress would
 * make the day's total climb while the technician looks at it and disagree with
 * every number the office has, so the clock that is still running is shown on
 * its own line instead (`timesheet-screen.tsx`).
 */
export function sumFinishedMinutes(
  entries: readonly Pick<TimeClockEntry, 'startedAt' | 'endedAt' | 'minutes'>[],
): number {
  return entries.reduce((total, entry) => total + (entryMinutes(entry) ?? 0), 0);
}

/** The local calendar day an instant falls on — a technician's own "today". */
export function dayIsoOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : localDateIso(d);
}

export interface ClockDayGroup {
  dateIso: string;
  /** "Today", "Yesterday", "Wed, Sep 23". */
  label: string;
  entries: TimeClockEntry[];
  /** Finished minutes on that day. */
  minutes: number;
}

/**
 * The week as a list of days, newest first — the order a technician checks it
 * in ("what did I do today", then yesterday). An entry is filed under the day
 * it **started**, so a shift that runs past midnight stays on the day it
 * belongs to rather than splitting in two.
 */
export function groupEntriesByDay(
  entries: readonly TimeClockEntry[],
  todayIso: string,
): ClockDayGroup[] {
  const byDay = new Map<string, TimeClockEntry[]>();
  for (const entry of entries) {
    const day = dayIsoOf(entry.startedAt);
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }

  const yesterdayIso = shiftDateIso(todayIso, -1);
  return [...byDay.keys()]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((dateIso) => {
      const list = [...byDay.get(dateIso)!].sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : -1,
      );
      return {
        dateIso,
        label:
          dateIso === todayIso
            ? 'Today'
            : dateIso === yesterdayIso
              ? 'Yesterday'
              : formatDayHeading(dateIso),
        entries: list,
        minutes: sumFinishedMinutes(list),
      };
    });
}

/** The entries that started on one local day. */
export function entriesOnDay(
  entries: readonly TimeClockEntry[],
  dateIso: string,
): TimeClockEntry[] {
  return entries.filter((entry) => dayIsoOf(entry.startedAt) === dateIso);
}

/**
 * One entry as a line: when it ran, and for how long.
 *
 * Wall-clock times, never "2 hours ago" — a technician querying a short day
 * with the office has to quote the same number the office is looking at, which
 * is the rule `jobs/lib.ts#formatStampTime` already sets for the job stamps.
 */
export function describeEntry(entry: TimeClockEntry): {
  span: string;
  length: string;
  running: boolean;
} {
  const from = formatStampTime(entry.startedAt) ?? '—';
  const minutes = entryMinutes(entry);
  if (minutes === null) {
    return { span: `${from} – now`, length: 'Running', running: true };
  }
  return {
    span: `${from} – ${formatStampTime(entry.endedAt) ?? '—'}`,
    length: formatHoursMinutes(minutes),
    running: false,
  };
}

/* ------------------------------------------------------------- the ranges */

const startOfDay = (dateIso: string): Date => new Date(`${dateIso}T00:00:00`);

export interface InstantRange {
  from: string;
  to: string;
}

/** One local day as the pair of instants that bound it. */
export function dayRange(dateIso: string): InstantRange {
  const from = startOfDay(dateIso);
  const to = startOfDay(shiftDateIso(dateIso, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * The week containing `dateIso`, **Monday to Sunday** — the same week the web
 * means by "week" (`apps/web/features/deals/lib.ts#datePresetRange`). The two
 * clients have to agree: a technician who checks their hours on the phone and
 * then in the browser must not be shown two different weeks.
 */
export function weekRange(dateIso: string): InstantRange {
  const base = startOfDay(dateIso);
  const mondayOffset = (base.getDay() + 6) % 7;
  const mondayIso = shiftDateIso(dateIso, -mondayOffset);
  return {
    from: startOfDay(mondayIso).toISOString(),
    to: startOfDay(shiftDateIso(mondayIso, 7)).toISOString(),
  };
}

/* ------------------------------------------------------ the one-minute rule */

/**
 * Workiz's own rule, copied: "There must be at least a one-minute separation
 * between clocking in and clocking out" (`WORKIZ_MOBILE_APP.md` §1.7).
 *
 * Enforced on the phone rather than left to the server, because the phone is
 * where the pair can be created offline: clock in at a door, realise it is the
 * wrong job, clock straight out, and both rows leave the queue together. Landed
 * as they were tapped that is a zero-minute entry somebody in the office has to
 * find and delete.
 */
export const MIN_CLOCK_SEPARATION_MS = 60_000;

/**
 * Two ways a start stamp can make this arithmetic meaningless, and in both the
 * answer is to let the technician out.
 *
 * The rule exists to stop a zero-minute entry somebody in the office has to
 * find and delete. It is not worth a shift that cannot be closed:
 *
 *  - a stamp the phone cannot read leaves every comparison `false`, which reads
 *    as "not a minute yet" forever — the button would be disabled for the rest
 *    of the day, with `NaN s to go` under it;
 *  - a stamp in the phone's own *future* can only have come from the server (a
 *    queued row carries `Date.now()`, which cannot be), so the two clocks
 *    disagree — and it is the server's, the one payroll uses, that will do the
 *    subtraction in the end.
 */
const unusable = (startedAtMs: number, now: number): boolean =>
  !Number.isFinite(startedAtMs) || now < startedAtMs;

export function canClockOut(startedAtMs: number, now: number): boolean {
  if (unusable(startedAtMs, now)) return true;
  return now - startedAtMs >= MIN_CLOCK_SEPARATION_MS;
}

/** How much longer the technician has to wait, in whole seconds. */
export function secondsUntilCanClockOut(startedAtMs: number, now: number): number {
  if (unusable(startedAtMs, now)) return 0;
  return Math.max(0, Math.ceil((MIN_CLOCK_SEPARATION_MS - (now - startedAtMs)) / 1000));
}

/* ------------------------------------------------------------ queue + server */

export const CLOCK_IN: OutboxKind = 'timeclock_in';
export const CLOCK_OUT: OutboxKind = 'timeclock_out';

export const TIMECLOCK_KINDS: ReadonlySet<OutboxKind> = new Set<OutboxKind>([
  CLOCK_IN,
  CLOCK_OUT,
]);

/**
 * Queue states in which the technician's tap has not been answered yet.
 *
 * `unknown` is in here on purpose. It means the app died mid-request and nobody
 * can say whether the clock-in landed — but the technician tapped it, so the
 * app follows their intent and shows the clock as running, with the row itself
 * visible on the Queue screen for them to settle. Showing "off the clock" to
 * somebody who is standing on a job working would be the worse guess.
 */
const IN_FLIGHT = new Set(['pending', 'sending', 'unknown']);

export type ClockState =
  /** Off the clock, as far as the phone and the server both know. */
  | { status: 'off' }
  /** Tapped, still in the queue. The stamp is the phone's own. */
  | { status: 'starting'; startedAt: string; dealId?: string; rowId: string }
  /** Running, on the server's stamp. */
  | { status: 'on'; entry: TimeClockEntry }
  /** Clocked out, still in the queue. */
  | { status: 'stopping'; startedAt?: string; endedAt: string; rowId: string };

/** A queued action, as opposed to a queued photo. */
export type OutboxQueueRecord = Extract<QueueRecord, { queue: 'outbox' }>;

const clockRows = (records: readonly QueueRecord[]): OutboxQueueRecord[] =>
  records
    .filter(
      (r): r is OutboxQueueRecord =>
        r.queue === 'outbox' && TIMECLOCK_KINDS.has(r.kind),
    )
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));

function parsePayload<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * What the clock is doing, from the server's answer **and** the outbox.
 *
 * The outbox wins while a row is still in flight. That is the whole point of
 * clocking in underground: `GET /timeclock/current` cannot answer in a
 * basement, and a technician who has tapped "Clock in" has to see a clock
 * running or they will tap it again.
 */
export function deriveClockState(
  current: TimeClockEntry | null | undefined,
  records: readonly QueueRecord[],
): ClockState {
  const rows = clockRows(records);
  const live = rows.find((r) => IN_FLIGHT.has(r.state));

  if (live) {
    if (live.kind === CLOCK_OUT) {
      const payload = parsePayload<ClockOutPayload>(live.payload);
      return {
        status: 'stopping',
        rowId: live.id,
        endedAt: payload?.clientEndedAt ?? new Date(live.createdAt).toISOString(),
        ...(current?.startedAt ? { startedAt: current.startedAt } : {}),
      };
    }
    const payload = parsePayload<ClockInPayload>(live.payload);
    return {
      status: 'starting',
      rowId: live.id,
      startedAt: payload?.clientStartedAt ?? new Date(live.createdAt).toISOString(),
      ...(live.dealId ? { dealId: live.dealId } : {}),
    };
  }

  /**
   * A row that has **landed** but whose answer is not in the cache yet.
   *
   * The queue marks a row `done` and the server's entry reaches the cache in
   * two separate steps (`queue-provider.tsx`), and a render can fall between
   * them. Without this, the card would blink "Not on the clock" at somebody who
   * had just clocked in — and a tap in that blink is a second entry. A landed
   * row that disagrees with the server is believed only until the server
   * catches up; the row is swept a minute later either way.
   */
  const landed = rows.find((r) => r.state === 'done');
  const running = current && isRunning(current) ? current : null;

  if (landed?.kind === CLOCK_OUT && running) {
    const payload = parsePayload<ClockOutPayload>(landed.payload);
    return {
      status: 'stopping',
      rowId: landed.id,
      endedAt: payload?.clientEndedAt ?? new Date(landed.createdAt).toISOString(),
      startedAt: running.startedAt,
    };
  }
  if (running) return { status: 'on', entry: running };
  if (landed?.kind === CLOCK_IN) {
    const payload = parsePayload<ClockInPayload>(landed.payload);
    return {
      status: 'starting',
      rowId: landed.id,
      startedAt: payload?.clientStartedAt ?? new Date(landed.createdAt).toISOString(),
      ...(landed.dealId ? { dealId: landed.dealId } : {}),
    };
  }
  return { status: 'off' };
}

/** Is the clock running (or about to be), whichever half of the pair said so? */
export function isOnTheClock(state: ClockState): boolean {
  return state.status === 'on' || state.status === 'starting';
}

/** Which job the clock is on, if any — the server's answer or the queued row's. */
export function clockDealId(state: ClockState): string | undefined {
  if (state.status === 'on') return state.entry.dealId;
  if (state.status === 'starting') return state.dealId;
  return undefined;
}

/** The stamp the running clock counts from, wherever it came from. */
export function clockStartedAt(state: ClockState): string | null {
  if (state.status === 'on') return state.entry.startedAt;
  if (state.status === 'starting') return state.startedAt;
  return null;
}

/**
 * Clock rows the queue has given up on.
 *
 * These are the ones that matter most: a clock-in that never landed is unpaid
 * work, and nothing else on this screen would say so — the clock simply reads
 * "not on the clock", which looks like the technician forgot.
 */
export function failedClockRows(
  records: readonly QueueRecord[],
): OutboxQueueRecord[] {
  return clockRows(records).filter(
    (r) => r.state === 'failed' || r.state === 'unknown',
  );
}
