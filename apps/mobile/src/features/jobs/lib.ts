import { JobSuperStatus, type Address, type Deal } from './types';

/**
 * The day list a technician works from.
 *
 * Ported field-for-field from the web's `apps/web/features/tech/lib.ts` on the
 * `bitcrm-f-tech` branch, deliberately: the phone and the browser must agree on
 * what "today" contains, in what order, down to the tie-break. The test file
 * carries the web's own vectors for the same reason.
 */

/* ------------------------------------------------------------------ dates */

const pad = (n: number) => String(n).padStart(2, '0');

/** The device's local calendar day as YYYY-MM-DD — a technician's "today". */
export function localDateIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** YYYY-MM-DD shifted by `days` (calendar arithmetic, no timezone drift). */
export function shiftDateIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateIso(d);
}

/** "9:00 AM" from "09:00"; the input echoed back when it isn't HH:MM. */
export function formatClock(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m[2]} ${suffix}`;
}

/**
 * The time a card leads with: "9:00 AM – 12:00 PM", "All day", or "No time"
 * for a dated job without a slot (the dispatcher hasn't set one yet).
 */
export function formatSlot(
  slot: string | undefined,
  allDay: boolean | undefined,
): string {
  if (allDay) return 'All day';
  if (!slot) return 'No time';
  const [start, end] = slot.split('-').map((s) => s.trim());
  if (!start) return 'No time';
  return end && end !== start
    ? `${formatClock(start)} – ${formatClock(end)}`
    : formatClock(start);
}

/** "Wed, Sep 23" — the heading for a day that isn't today or tomorrow. */
export function formatDayHeading(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/* ---------------------------------------------------------------- groups */

/** Statuses a technician is finished with — dropped from earlier days. */
const CLOSED: ReadonlySet<JobSuperStatus> = new Set<JobSuperStatus>([
  JobSuperStatus.DONE,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  JobSuperStatus.CANCELED,
]);

export const isClosedJob = (d: Pick<Deal, 'superStatus'>): boolean =>
  CLOSED.has(d.superStatus);

export type JobDayKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'unscheduled'
  | `day:${string}`;

export interface JobDayGroup {
  key: JobDayKey;
  label: string;
  /** The calendar day this group is for (absent for overdue/unscheduled). */
  dateIso?: string;
  deals: Deal[];
}

/** Slot start as "HH:MM" for sorting; "~" sorts undated/untimed jobs last. */
const slotStart = (d: Deal): string => {
  const start = d.scheduledTimeSlot?.split('-')[0]?.trim();
  return start && /^\d{2}:\d{2}$/.test(start) ? start : '~';
};

/**
 * Visit order inside a day: the technician's own route position when the
 * dispatcher set one (`sequences[techId]`), then the slot start, then the
 * job number so the order is stable.
 */
export function compareVisitOrder(a: Deal, b: Deal, techId?: string): number {
  const sa = techId ? a.sequences?.[techId] : undefined;
  const sb = techId ? b.sequences?.[techId] : undefined;
  if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
  if (sa !== undefined && sb === undefined) return -1;
  if (sa === undefined && sb !== undefined) return 1;
  const ta = slotStart(a);
  const tb = slotStart(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a.dealNumber).localeCompare(String(b.dealNumber));
}

/**
 * A technician's jobs as the day list they work from: what is still open from
 * earlier days first (it needs attention), then today, then tomorrow and each
 * later day under its own heading, and finally the jobs assigned to them that
 * have no date yet. Closed jobs (Done / Canceled) survive only on today's list
 * — yesterday's finished work, and a job canceled for next Tuesday, are history
 * rather than a to-do — and every day is in visit order.
 */
export function groupJobsByDay(
  deals: Deal[],
  todayIso: string,
  techId?: string,
): JobDayGroup[] {
  const tomorrowIso = shiftDateIso(todayIso, 1);
  const overdue: Deal[] = [];
  const unscheduled: Deal[] = [];
  const byDay = new Map<string, Deal[]>();

  for (const d of deals) {
    const day = d.scheduledDate?.slice(0, 10);
    // Closed work is history, not a to-do, and survives only on today's list —
    // where "I finished that this morning" is still worth seeing. A job
    // canceled for next Tuesday is not a stop on next Tuesday's route.
    if (isClosedJob(d) && day !== todayIso) continue;
    if (!day) {
      unscheduled.push(d);
      continue;
    }
    if (day < todayIso) {
      overdue.push(d);
      continue;
    }
    const list = byDay.get(day) ?? [];
    list.push(d);
    byDay.set(day, list);
  }

  const sort = (list: Deal[]) =>
    [...list].sort((a, b) => compareVisitOrder(a, b, techId));
  const groups: JobDayGroup[] = [];

  if (overdue.length) {
    groups.push({
      key: 'overdue',
      label: 'Still open from earlier',
      deals: sort(overdue),
    });
  }
  // Today always shows, even empty, so the page has an anchor for the day.
  groups.push({
    key: 'today',
    label: 'Today',
    dateIso: todayIso,
    deals: sort(byDay.get(todayIso) ?? []),
  });

  const later = [...byDay.keys()].filter((day) => day > todayIso).sort();
  for (const day of later) {
    if (day === tomorrowIso) {
      groups.push({
        key: 'tomorrow',
        label: 'Tomorrow',
        dateIso: day,
        deals: sort(byDay.get(day)!),
      });
    } else {
      groups.push({
        key: `day:${day}`,
        label: formatDayHeading(day),
        dateIso: day,
        deals: sort(byDay.get(day)!),
      });
    }
  }

  if (unscheduled.length) {
    groups.push({
      key: 'unscheduled',
      label: 'Not scheduled yet',
      deals: sort(unscheduled),
    });
  }
  return groups;
}

/**
 * The list for whichever day the technician has moved to.
 *
 * On **today** this is the day list above, unchanged — what is still open from
 * earlier, today, tomorrow, the days after, then the undated jobs. That view is
 * where a technician starts and what they work from, and moving days must not
 * cost them the two groups that only exist there: an overdue job and an undated
 * one belong to no day, so a screen showing one day at a time would hide them.
 *
 * On any other day it is that day and nothing else — Workiz's Schedule tab,
 * which shows the visits of the date it is on (§1.3). A past day keeps its
 * closed jobs: the technician navigated there deliberately, and "what did I do
 * on Tuesday" is the only question that takes them backwards.
 */
export function groupJobsForDay(
  deals: Deal[],
  selectedIso: string,
  todayIso: string,
  techId?: string,
): JobDayGroup[] {
  if (selectedIso === todayIso) return groupJobsByDay(deals, todayIso, techId);

  const onDay = deals
    .filter((d) => d.scheduledDate?.slice(0, 10) === selectedIso)
    .sort((a, b) => compareVisitOrder(a, b, techId));

  const tomorrowIso = shiftDateIso(todayIso, 1);
  return [
    {
      key: selectedIso === tomorrowIso ? 'tomorrow' : `day:${selectedIso}`,
      label: selectedIso === tomorrowIso ? 'Tomorrow' : formatDayHeading(selectedIso),
      dateIso: selectedIso,
      deals: onDay,
    },
  ];
}

/* --------------------------------------------------------------- address */

/** One-line service address for a card; empty when nothing is filled in. */
export function addressLine(a: Address | undefined): string {
  if (!a) return '';
  const street = [a.street, a.unit].filter(Boolean).join(', ');
  const locality = [a.city, [a.state, a.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [street, locality].filter(Boolean).join(', ');
}

/**
 * Tap-to-navigate link. Google Maps' universal directions URL opens the
 * installed Maps app on both iOS and Android; coordinates win over the typed
 * address when the job was geocoded, so a misspelt street still leads to the
 * right door.
 */
export function navigationUrl(a: Address | undefined): string | null {
  if (!a) return null;
  const dest =
    typeof a.lat === 'number' && typeof a.lng === 'number'
      ? `${a.lat},${a.lng}`
      : addressLine(a);
  if (!dest) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/* --------------------------------------------------------------- actions */

/**
 * Which technician actions a job offers, from what has already happened to it:
 * confirm receipt → on my way → arrived → start (In Progress) → done. A closed
 * job offers nothing but a call.
 */
export interface TechActionState {
  /** "Confirm receipt" — until somebody has acknowledged the job. */
  canConfirm: boolean;
  /** "On my way" / "Running late" texts to the client — while the job is open. */
  canNotify: boolean;
  /** "Arrived" — once, on an open job. */
  canArrive: boolean;
  /** "Start" — Submitted → In Progress. */
  canStart: boolean;
  /** "Done" — In Progress (or Pending) → Done. */
  canFinish: boolean;
  /** "Reschedule" — moving the visit, while the job is still open (§1.3). */
  canReschedule: boolean;
}

export function techActionState(
  deal: Pick<Deal, 'superStatus' | 'techConfirmedAt' | 'arrivedAt'>,
): TechActionState {
  const closed = isClosedJob(deal);
  return {
    canConfirm: !closed && !deal.techConfirmedAt,
    canNotify: !closed,
    canArrive: !closed && !deal.arrivedAt,
    canStart: deal.superStatus === JobSuperStatus.SUBMITTED,
    canFinish:
      deal.superStatus === JobSuperStatus.IN_PROGRESS ||
      deal.superStatus === JobSuperStatus.PENDING,
    // A job that is done or cancelled has no visit left to move, and the one
    // thing worse than not being able to reschedule it is appearing to.
    canReschedule: !closed,
  };
}

/* ---------------------------------------------------------------- status */

/**
 * How a status reads on a chip. Colour is never the only carrier — the word is
 * always there, and the pill's own shape differs — so the chip still works in
 * sunlight, in monochrome, and for a colour-blind technician (§2.9).
 */
export type StatusTone = 'neutral' | 'active' | 'done' | 'warning' | 'canceled';

const STATUS_LABELS: Record<JobSuperStatus, string> = {
  [JobSuperStatus.SUBMITTED]: 'Submitted',
  [JobSuperStatus.IN_PROGRESS]: 'In progress',
  [JobSuperStatus.DONE]: 'Done',
  [JobSuperStatus.PENDING]: 'Pending',
  [JobSuperStatus.DONE_PENDING_APPROVAL]: 'Awaiting approval',
  [JobSuperStatus.CANCELED]: 'Canceled',
};

const STATUS_TONES: Record<JobSuperStatus, StatusTone> = {
  [JobSuperStatus.SUBMITTED]: 'neutral',
  [JobSuperStatus.IN_PROGRESS]: 'active',
  [JobSuperStatus.DONE]: 'done',
  [JobSuperStatus.PENDING]: 'warning',
  [JobSuperStatus.DONE_PENDING_APPROVAL]: 'warning',
  [JobSuperStatus.CANCELED]: 'canceled',
};

/** A status the app has never heard of still has to render as something. */
export function statusLabel(status: JobSuperStatus | string): string {
  return STATUS_LABELS[status as JobSuperStatus] ?? String(status);
}

export function statusTone(status: JobSuperStatus | string): StatusTone {
  return STATUS_TONES[status as JobSuperStatus] ?? 'neutral';
}

/** The client's name as the job carries it — the per-job override wins. */
export function clientDisplayName(deal: Pick<Deal, 'clientName'>): string {
  const n = deal.clientName;
  if (!n) return '';
  return [n.firstName, n.lastName].filter(Boolean).join(' ').trim();
}

/**
 * A wall-clock stamp, not "12 minutes ago": a technician reading this back to a
 * dispatcher on the phone needs the same number the dispatcher is looking at.
 */
export function formatStampTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface JobStamp {
  key: 'sent' | 'seen' | 'arrived';
  label: string;
  /** Wall-clock time, or null while the step has not happened. */
  time: string | null;
  done: boolean;
}

/**
 * The three-step receipt on a job card: dispatch **sent** it, the technician
 * **saw** it, the technician **arrived**.
 *
 * This is the same trail dispatch watches from the other end, so it is on the
 * card rather than buried in the timeline — a technician asked "did you get
 * the 2 o'clock?" can answer from the list without opening anything. Dispatch
 * reads those two columns off `sentToTechAt` and `seenByTechAt`
 * (`apps/web/features/deals/lib.ts:342-355`), so the phone reads the same two
 * or the two ends of the same conversation disagree.
 *
 * Each label therefore names the field that actually means it:
 *
 *   - **Sent** is `sentToTechAt` — the moment a dispatcher pressed "Send to
 *     tech" (`deals.service.ts:1016`). It was `createdAt` until this was
 *     fixed, which is when the *job* was written down. Those are routinely
 *     days apart: a job booked Monday for Thursday read "Sent 9:12 AM" on
 *     Monday. It is the one number a technician quotes back down the phone,
 *     so being confidently wrong about it is worse than leaving it blank.
 *   - **Seen** is `seenByTechAt`, stamped on first open by
 *     `POST /deals/:id/seen` (`deals.service.ts:1057`). It was
 *     `techConfirmedAt`, which is a different act: "Confirm receipt" is a
 *     button a technician presses, not the app noticing they looked. A job
 *     confirmed but never opened claimed to have been seen, and one opened
 *     ten times but not confirmed claimed it never was.
 *   - **Arrived** is `arrivedAt` (`deals.service.ts:1244`), which was right.
 */
export function jobStamps(
  deal: Pick<Deal, 'sentToTechAt' | 'seenByTechAt' | 'arrivedAt'>,
): JobStamp[] {
  const step = (
    key: JobStamp['key'],
    label: string,
    iso: string | undefined,
  ): JobStamp => {
    const time = formatStampTime(iso);
    // A stamp we cannot read the time of is still a stamp — the step happened.
    return { key, label, time, done: Boolean(iso) };
  };
  return [
    step('sent', 'Sent', deal.sentToTechAt),
    step('seen', 'Seen', deal.seenByTechAt),
    step('arrived', 'Arrived', deal.arrivedAt),
  ];
}
