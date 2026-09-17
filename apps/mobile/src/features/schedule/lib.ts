import type { JobSuperStatus } from '@bitcrm/types';
import type { Deal } from '../jobs/types';
import {
  addressLine,
  clientDisplayName,
  compareVisitOrder,
  formatSlot,
  statusLabel,
} from '../jobs/lib';

/**
 * The Schedule tab, as pure functions.
 *
 * Workiz's Schedule is a month in the header, a `Timeline / Day` switch, a
 * week strip and an hour grid (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4).
 * Timeline is the day list this app already had; **Day** is the new half, and
 * placing a job on an hour grid is arithmetic — which hours to draw, where a
 * block starts, how wide it is when two jobs overlap — so it is here, where it
 * can be tested, rather than inside a component that can only be looked at.
 *
 * Minutes are minutes since midnight, local. Dates are `YYYY-MM-DD` and are
 * compared as strings, never as `Date`s: a technician in a timezone that
 * shifts at 2am must not lose a day at the turn of the clocks.
 */

/* ------------------------------------------------------------------ hours */

/** "11am", "12pm", "1pm", "12am" — Workiz's own lowercase labels (§4). */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

/** `09:00-12:00` as minutes since midnight, or null when there is no slot. */
export function parseSlotMinutes(
  slot: string | undefined,
): { start: number; end: number } | null {
  if (!slot) return null;
  const [rawStart, rawEnd] = slot.split('-').map((s) => s.trim());
  const start = parseClock(rawStart);
  if (start === null) return null;
  const end = parseClock(rawEnd);
  // A slot with no end, or an end that is not after the start, still has to
  // draw as something a thumb can hit: an hour, which is what a dispatcher
  // means by a bare time.
  return { start, end: end !== null && end > start ? end : start + 60 };
}

function parseClock(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The working window the grid opens on: 7am to 7pm.
 *
 * Wide enough for a normal day and short enough that the whole of it is one
 * screen and a bit, so a technician glancing at the tab sees the shape of the
 * day rather than the middle of the night.
 */
export const DEFAULT_GRID_FROM = 7;
export const DEFAULT_GRID_TO = 19;

/**
 * Which hours to draw: the default window, widened to hold everything on the
 * day. A 6am start and an 11pm finish both happen in this trade, and a grid
 * that quietly cropped either would hide a job entirely.
 */
export function gridRange(deals: readonly Deal[]): { from: number; to: number } {
  let from = DEFAULT_GRID_FROM;
  let to = DEFAULT_GRID_TO;
  for (const deal of deals) {
    if (deal.allDay) continue;
    const slot = parseSlotMinutes(deal.scheduledTimeSlot);
    if (!slot) continue;
    from = Math.min(from, Math.floor(slot.start / 60));
    to = Math.max(to, Math.ceil(slot.end / 60));
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

export interface PlacedJob {
  deal: Deal;
  startMin: number;
  endMin: number;
  /** Which of `columns` side-by-side lanes this block sits in. */
  column: number;
  /** How many lanes the overlapping group it belongs to needs. */
  columns: number;
}

export interface DayLayout {
  placed: PlacedJob[];
  /** All-day work, and jobs dispatch has dated but not timed. */
  unplaced: Deal[];
}

/**
 * Where each job sits on the grid.
 *
 * Two jobs at the same hour is normal — a dispatcher double-books a window and
 * sorts it out on the phone — so overlapping blocks are laid out side by side
 * rather than on top of each other, which would hide one of them completely.
 * The lane count is per overlapping *group*, not per day: one clash at 9am
 * must not squeeze a lone 4pm job into half the width.
 *
 * A job with no time cannot be placed at all and is handed back separately
 * rather than dropped. Dropping it would mean a dated job that simply does not
 * appear on the day it is dated, which is the worst thing a schedule can do.
 */
export function layoutDay(deals: readonly Deal[], techId?: string): DayLayout {
  const placed: PlacedJob[] = [];
  const unplaced: Deal[] = [];

  for (const deal of deals) {
    const slot = deal.allDay ? null : parseSlotMinutes(deal.scheduledTimeSlot);
    if (!slot) {
      unplaced.push(deal);
      continue;
    }
    placed.push({ deal, startMin: slot.start, endMin: slot.end, column: 0, columns: 1 });
  }

  placed.sort(
    (a, b) => a.startMin - b.startMin || compareVisitOrder(a.deal, b.deal, techId),
  );

  // One pass, greedy: a block joins the open group while it starts before the
  // group's furthest end, and takes the first lane free at that moment.
  let group: PlacedJob[] = [];
  let groupEnd = -1;

  const closeGroup = () => {
    const lanes = group.reduce((max, p) => Math.max(max, p.column + 1), 1);
    for (const p of group) p.columns = lanes;
    group = [];
    groupEnd = -1;
  };

  for (const block of placed) {
    if (group.length > 0 && block.startMin >= groupEnd) closeGroup();
    const taken = new Set(
      group.filter((p) => p.endMin > block.startMin).map((p) => p.column),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    block.column = lane;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.endMin);
  }
  if (group.length > 0) closeGroup();

  unplaced.sort((a, b) => compareVisitOrder(a, b, techId));
  return { placed, unplaced };
}

/** What a block says to a screen reader, which cannot see where it sits. */
export function blockLabel(deal: Deal): string {
  const parts = [
    formatSlot(deal.scheduledTimeSlot, deal.allDay),
    clientDisplayName(deal) || `Job ${deal.dealNumber}`,
    statusLabel(deal.superStatus),
  ];
  return parts.filter(Boolean).join(', ');
}

/* ------------------------------------------------------------------- week */

export interface WeekDay {
  iso: string;
  /** "Sun" — three letters, because "S" twice is a puzzle in sunlight. */
  weekday: string;
  /** "13". */
  day: string;
  isToday: boolean;
  isSelected: boolean;
  /** How many jobs sit on it. */
  visits: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** The Sunday on or before `dateIso`. */
export function weekStartIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  d.setDate(d.getDate() - d.getDay());
  return toIso(d);
}

function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `Sun 13 … Sat 19` — the strip over Workiz's Day view (§4).
 *
 * Sunday-first, like the calendar sheet this app already has and like every US
 * phone; the dispatcher's Monday-first working week belongs to the web.
 */
export function weekOf(
  selectedIso: string,
  todayIso: string,
  deals: readonly Deal[],
): WeekDay[] {
  const start = new Date(`${weekStartIso(selectedIso)}T00:00:00`);
  const visits = new Map<string, number>();
  for (const deal of deals) {
    const day = deal.scheduledDate?.slice(0, 10);
    if (day) visits.set(day, (visits.get(day) ?? 0) + 1);
  }

  return WEEKDAYS.map((weekday, offset) => {
    const d = new Date(start);
    d.setDate(d.getDate() + offset);
    const iso = toIso(d);
    return {
      iso,
      weekday,
      day: String(d.getDate()),
      isToday: iso === todayIso,
      isSelected: iso === selectedIso,
      visits: visits.get(iso) ?? 0,
    };
  });
}

/** "September" — the header's month, as Workiz writes it (§4). */
export function monthTitle(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString('en-US', { month: 'long' });
}

/* ------------------------------------------------------ filter and search */

export interface ScheduleFilter {
  /** Empty means every status — a filter nobody set narrows nothing. */
  statuses: readonly (JobSuperStatus | string)[];
}

export const NO_FILTER: ScheduleFilter = { statuses: [] };

export function isFiltering(filter: ScheduleFilter, query: string): boolean {
  return filter.statuses.length > 0 || query.trim().length > 0;
}

/** The statuses actually present, with counts — a filter offers only real rows. */
export function statusOptions(
  deals: readonly Deal[],
): { status: JobSuperStatus | string; label: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const deal of deals) {
    const key = String(deal.superStatus);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([status, count]) => ({ status, label: statusLabel(status), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Search, over what is written on the card: the job number, the client, the
 * address. Case and spacing are forgiven, because this is typed one-handed.
 */
export function searchMatch(deal: Deal, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    String(deal.dealNumber ?? ''),
    clientDisplayName(deal),
    addressLine(deal.address),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/**
 * The one predicate the list and the grid both use, so the two Schedule modes
 * can never disagree about which jobs a filter leaves standing.
 */
export function makeMatcher(
  filter: ScheduleFilter,
  query: string,
): (deal: Deal) => boolean {
  const statuses = new Set(filter.statuses.map(String));
  return (deal) =>
    (statuses.size === 0 || statuses.has(String(deal.superStatus))) &&
    searchMatch(deal, query);
}

/** The jobs on one day, filtered and in visit order. */
export function jobsOnDay(
  deals: readonly Deal[],
  dateIso: string,
  match: (deal: Deal) => boolean,
  techId?: string,
): Deal[] {
  return deals
    .filter((d) => d.scheduledDate?.slice(0, 10) === dateIso && match(d))
    .sort((a, b) => compareVisitOrder(a, b, techId));
}

/** "3 jobs" / "1 job" / "No jobs" — said out loud, never left to a dot. */
export function jobCountLabel(count: number): string {
  if (count <= 0) return 'No jobs';
  return count === 1 ? '1 job' : `${count} jobs`;
}
