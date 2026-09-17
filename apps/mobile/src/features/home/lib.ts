import { JobSuperStatus, type Deal } from '../jobs/types';
import {
  compareVisitOrder,
  groupJobsByDay,
  isClosedJob,
  statusLabel,
} from '../jobs/lib';

/**
 * What the first screen answers.
 *
 * Workiz's Home is a greeting, an **Upcoming work** card and a dashboard
 * widget (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §3) — not a list. The list
 * is the Schedule tab's job. So everything here reduces the day list the phone
 * already holds down to two answers: *what am I doing next*, and *how is the
 * day going*. No new request is involved in either.
 */

/** "Hey Dana, here is your upcoming day" — Workiz's own line (§3). */
export function greeting(firstName?: string): string {
  const name = firstName?.trim();
  return name
    ? `Hey ${name}, here is your upcoming day`
    : 'Here is your upcoming day';
}

/** Day + slot + job number: the order a technician would drive them in. */
function compareByDayThenSlot(a: Deal, b: Deal, techId?: string): number {
  const da = a.scheduledDate?.slice(0, 10) ?? '';
  const db = b.scheduledDate?.slice(0, 10) ?? '';
  if (da !== db) return da < db ? -1 : 1;
  return compareVisitOrder(a, b, techId);
}

/**
 * The next stop.
 *
 * Today or later, and still open: a job that is done or cancelled is not
 * upcoming, and neither is a job dated last Tuesday — that one is a problem to
 * chase rather than the next thing to drive to, and putting it in a card
 * headed "Upcoming work" would be a lie a technician has to decode. Overdue
 * work is counted in the widget below instead, where it reads as what it is.
 *
 * No clock is needed: this morning's job is still the next one if nobody has
 * closed it, whatever the time now is.
 */
export function nextJob(
  deals: readonly Deal[],
  todayIso: string,
  techId?: string,
): Deal | undefined {
  const upcoming = deals.filter((d) => {
    const day = d.scheduledDate?.slice(0, 10);
    return Boolean(day) && day! >= todayIso && !isClosedJob(d);
  });
  if (upcoming.length === 0) return undefined;
  return [...upcoming].sort((a, b) => compareByDayThenSlot(a, b, techId))[0];
}

export interface StatusCount {
  status: JobSuperStatus | string;
  label: string;
  count: number;
}

/**
 * The order the widget reads in: what has not started, what is running, what
 * is waiting on somebody, then what is finished with.
 */
const COUNT_ORDER: readonly JobSuperStatus[] = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  JobSuperStatus.DONE,
  JobSuperStatus.CANCELED,
];

/**
 * The technician's own jobs by status — our answer to Workiz's "My jobs /
 * Submitted 1" widget (§3).
 *
 * Counted over exactly what the day list shows, `groupJobsByDay`: everything
 * still open from earlier, today, the days ahead and the undated jobs. That
 * matters more than it looks — a count taken over "every job on the phone"
 * would quietly include last month's finished work and read as a number
 * nobody could tie to anything they can see.
 *
 * Statuses with nothing in them are dropped rather than shown as zero. A
 * column of zeroes is noise at arm's length, and the empty case is a sentence
 * rather than six of them.
 */
export function statusCounts(
  deals: readonly Deal[],
  todayIso: string,
  techId?: string,
): StatusCount[] {
  const tally = new Map<string, number>();
  for (const group of groupJobsByDay([...deals], todayIso, techId)) {
    for (const deal of group.deals) {
      const key = String(deal.superStatus);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }

  const known = COUNT_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    count: tally.get(String(status)) ?? 0,
  })).filter((row) => row.count > 0);

  // A status this build has never heard of still has to be counted, or the
  // rows would not add up to the number beside the title.
  const extras = [...tally.entries()]
    .filter(([status]) => !COUNT_ORDER.some((s) => String(s) === status))
    .map(([status, count]) => ({ status, label: statusLabel(status), count }));

  return [...known, ...extras];
}

/** How many jobs those counts are over. */
export function totalOf(counts: readonly StatusCount[]): number {
  return counts.reduce((sum, row) => sum + row.count, 0);
}

const MINUTE_MS = 60_000;

/**
 * "Updated 4 minutes ago" — the line under every Workiz widget title (§3).
 *
 * It is there because the number above it may be an hour old: the day list is
 * served from a cache that survives being underground, and a widget that
 * cannot say when it was last right is a widget a technician cannot trust. So
 * the vague end is deliberately vague — past the hour it stops counting rather
 * than claiming a precision the cache does not have.
 */
export function updatedAgoLabel(updatedAt: number, now: number): string {
  if (!updatedAt) return 'Not updated yet';
  const minutes = Math.floor(Math.max(0, now - updatedAt) / MINUTE_MS);
  if (minutes < 1) return 'Updated just now';
  if (minutes === 1) return 'Updated 1 minute ago';
  if (minutes < 60) return `Updated ${minutes} minutes ago`;
  return 'Updated over an hour ago';
}
