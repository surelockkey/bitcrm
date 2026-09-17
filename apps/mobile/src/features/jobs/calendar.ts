import type { Deal } from './types';
import { formatDayHeading, isClosedJob, shiftDateIso } from './lib';

/**
 * Moving between days.
 *
 * Workiz's Schedule tab shows **one day**, with the dates scrollable, a
 * calendar that expands over the list, a count of the visits on the day it is
 * showing, and a dot under any date that still has unclosed work on it
 * (`docs/import/WORKIZ_MOBILE_APP.md` §1.3). This file is that behaviour as
 * pure functions, so the screen only has to draw what they answer.
 *
 * Dates are `YYYY-MM-DD` strings and months `YYYY-MM`, computed arithmetically
 * rather than by adding milliseconds to a `Date`: a technician in a timezone
 * that changes at 2am must not lose or repeat a day at the turn of the clocks.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The month a day falls in, as `YYYY-MM`. */
export function monthOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

function parseMonth(monthIso: string): { year: number; month: number } {
  const year = Number(monthIso.slice(0, 4));
  const month = Number(monthIso.slice(5, 7));
  return { year, month };
}

/** `YYYY-MM` shifted by whole months, over year boundaries in both directions. */
export function shiftMonthIso(monthIso: string, months: number): string {
  const { year, month } = parseMonth(monthIso);
  const ordinal = year * 12 + (month - 1) + months;
  return `${String(Math.floor(ordinal / 12)).padStart(4, '0')}-${pad2(
    ((ordinal % 12) + 12) % 12 + 1,
  )}`;
}

/** "September 2026" — the calendar's own heading. */
export function monthLabel(monthIso: string): string {
  const { year, month } = parseMonth(monthIso);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The column headings, Sunday first.
 *
 * Deliberately not the web's Monday-first week (`apps/web/features/schedule/lib.ts`):
 * that grid is a dispatcher's *working* week, while this is the calendar a
 * technician already has on their phone, and every US phone starts it on
 * Sunday. Three letters rather than one, because "T" twice and "S" twice is a
 * puzzle at arm's length in sunlight.
 */
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * A month as rows of seven, `null` where a cell belongs to a neighbouring
 * month. Only the rows the month actually needs, so February does not leave an
 * empty band under the sheet.
 */
export function monthMatrix(monthIso: string): (string | null)[][] {
  const { year, month } = parseMonth(monthIso);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  // Day 0 of the next month is the last day of this one.
  const days = new Date(year, month, 0).getDate();

  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= days; day++) {
    cells.push(`${monthIso}-${pad2(day)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** What a calendar cell has to say about its day. */
export interface DayMark {
  /** Every job the technician has on that day, closed ones included. */
  visits: number;
  /**
   * Workiz's dot: work on a day already past that nobody has closed. It is the
   * one thing on the calendar worth a second colour — an old job left open is
   * the only reason a technician looks backwards at all (§1.3).
   */
  hasOpenPast: boolean;
}

/**
 * The calendar's dots, over every job this phone holds — which after the day
 * list has loaded once is the technician's whole assigned set, so the calendar
 * keeps working with no signal.
 */
export function dayMarks(
  deals: readonly Deal[],
  todayIso: string,
): Map<string, DayMark> {
  const marks = new Map<string, DayMark>();
  for (const deal of deals) {
    const day = deal.scheduledDate?.slice(0, 10);
    if (!day) continue;
    const mark = marks.get(day) ?? { visits: 0, hasOpenPast: false };
    mark.visits += 1;
    if (day < todayIso && !isClosedJob(deal)) mark.hasOpenPast = true;
    marks.set(day, mark);
  }
  return marks;
}

/** How many visits a day holds — the counter Workiz puts beside the date. */
export function visitsOn(deals: readonly Deal[], dateIso: string): number {
  return deals.filter((d) => d.scheduledDate?.slice(0, 10) === dateIso).length;
}

/** "No visits" / "1 visit" / "4 visits". */
export function visitCountLabel(visits: number): string {
  if (visits <= 0) return 'No visits';
  return visits === 1 ? '1 visit' : `${visits} visits`;
}

/**
 * "Today", "Tomorrow", "Yesterday" — or nothing for a day far enough out that
 * only its date means anything. Those three are the days a technician actually
 * moves between, and a name is read faster than a date.
 */
export function dayRelativeName(
  selectedIso: string,
  todayIso: string,
): string | null {
  if (selectedIso === todayIso) return 'Today';
  if (selectedIso === shiftDateIso(todayIso, 1)) return 'Tomorrow';
  if (selectedIso === shiftDateIso(todayIso, -1)) return 'Yesterday';
  return null;
}

/** The date the day bar leads with: "Wed, Sep 23". */
export const dayNavTitle = (selectedIso: string): string =>
  formatDayHeading(selectedIso);

/**
 * The line under it: which day this is in a technician's own terms, and how
 * much is on it — Workiz's day counter (§1.3).
 *
 * The relative name lives here rather than in the title on purpose: the list
 * below already heads its groups "Today" and "Tomorrow", and a bar repeating
 * the same word directly above them reads as a second heading rather than as
 * navigation. The date is the one thing the list never says.
 */
export function dayNavCaption(
  selectedIso: string,
  todayIso: string,
  visits: number,
): string {
  const name = dayRelativeName(selectedIso, todayIso);
  const count = visitCountLabel(visits);
  return name ? `${name} · ${count}` : count;
}

/** What a swipe on the day list is wired to do. */
export interface DaySwipeHandlers {
  onMoveShouldSetPanResponder: (
    event: unknown,
    gesture: { dx: number; dy: number },
  ) => boolean;
  onPanResponderRelease: (
    event: unknown,
    gesture: { dx: number; dy: number },
  ) => void;
}

/**
 * The swipe, as the two callbacks `PanResponder.create` is handed.
 *
 * Built here rather than inline in the screen so the wiring itself is
 * testable: what a drag does is then a test rather than a thing we hope
 * PanResponder is doing. The responder is claimed on *move*, never on touch —
 * the list under it has to keep scrolling, and a responder that grabbed the
 * touch down would swallow every scroll.
 */
export function daySwipeHandlers(
  step: (days: number) => void,
): DaySwipeHandlers {
  return {
    onMoveShouldSetPanResponder: (_event, { dx, dy }) => swipeIntent(dx, dy) !== null,
    onPanResponderRelease: (_event, { dx, dy }) => {
      const intent = swipeIntent(dx, dy);
      if (intent === 'next') step(1);
      else if (intent === 'prev') step(-1);
    },
  };
}

/** Which way a swipe went, once it is clearly a swipe. */
export type SwipeIntent = 'prev' | 'next' | null;

/** A thumb has to travel this far across before the day changes under it. */
export const SWIPE_DISTANCE = 48;

/**
 * Reading a drag.
 *
 * The day list scrolls vertically under the same thumb, so a gesture only
 * counts as a day change when it is both far enough and clearly sideways —
 * otherwise a technician scrolling their route with a slightly crooked thumb
 * would land on another day. Dragging left brings the next day in from the
 * right, the direction every phone calendar moves.
 */
export function swipeIntent(dx: number, dy: number): SwipeIntent {
  if (Math.abs(dx) < SWIPE_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}
