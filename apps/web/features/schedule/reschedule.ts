import type { Deal } from "@bitcrm/types";
import { DEFAULT_TZ, ctToZoneWall, wallToCt } from "@/lib/timezone";
import { addDays, daysBetween } from "./calendar";
import { parseSlot } from "./lib";

/** The grid's step: Workiz's calendar snaps a dragged job to quarter hours. */
export const SNAP_MINUTES = 15;

/** The nearest quarter hour, inside the day (a job still has to start before midnight). */
export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.min(Math.max(snapped, 0), 24 * 60 - step);
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "HH:MM-HH:MM", the end held at 23:59 — a slot cannot run into the next day. */
export function formatSlot(startMin: number, endMin: number): string {
  return `${hhmm(startMin)}-${hhmm(Math.min(endMin, 24 * 60 - 1))}`;
}

/**
 * The crew after a job is dropped on another Timeline row: the technician it
 * was dragged off (`from`, null for the Unassigned row) gives way to the one
 * it was dropped on (`to`, null for Unassigned); the rest of the crew stays.
 */
export function nextTechIds(ids: string[], from: string | null, to: string | null): string[] {
  if (!to) return ids.filter((id) => id !== from);
  if (!from) return ids.includes(to) ? [...ids] : [...ids, to];
  // Already on the job: the drop only takes the dragged technician off.
  if (ids.includes(to)) return ids.filter((id) => id !== from);
  return ids.map((id) => (id === from ? to : id));
}

export interface MoveBody {
  scheduledDate: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
}

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * The update a drop sends: the job's new first day (its last day moving with
 * it) and, when it was dropped on an hour, its new start — the same length as
 * before. An all-day job only moves by days.
 *
 * The drop is read on Connecticut's grid; the API keeps the visit on the
 * clock of `zone`, the one it was booked in (2026-10-12 owner rule). So a
 * start dropped on an hour goes back to that clock (a Texas job dropped at
 * 12:00 EDT is saved at 11:00), and a move by days counts them on
 * Connecticut's calendar, the job keeping its own times.
 */
export function moveBody(
  deal: Deal,
  { date, startMin }: { date: string; startMin?: number },
  zone: string = DEFAULT_TZ,
): MoveBody {
  const from = deal.scheduledDate ?? date;
  const span = deal.scheduledEndDate && deal.scheduledEndDate > from ? daysBetween(from, deal.scheduledEndDate) : 0;
  const slot = deal.allDay ? null : parseSlot(deal.scheduledTimeSlot);
  const days = (to: string): MoveBody => {
    const body: MoveBody = { scheduledDate: to };
    if (span > 0) body.scheduledEndDate = addDays(to, span);
    return body;
  };
  // A day with no time is a date: it moves to the day it was dropped on.
  if (!slot || !deal.scheduledDate) return days(date);
  if (startMin === undefined || span > 0) {
    const shownOn = wallToCt(deal.scheduledDate, deal.scheduledTimeSlot!.slice(0, 5), zone).date;
    return { ...days(addDays(deal.scheduledDate, daysBetween(shownOn, date))), scheduledTimeSlot: deal.scheduledTimeSlot };
  }
  const at = ctToZoneWall(date, hhmm(startMin), zone);
  const start = minutesOf(at.time);
  return { scheduledDate: at.date, scheduledTimeSlot: formatSlot(start, start + Math.max(slot.end - slot.start, 0)) };
}

/* ------------------------------------------------------------ the drop */

/**
 * What is being dragged, and how its move is read. `startDate` is the day it
 * is drawn on — Connecticut's, which a late visit west of it may not be
 * stored on; left out, the day it is stored on.
 */
export type DragSource = (
  /** A box in the Day/Week hours: moved by the minutes it was dragged, to the column it was dropped on. */
  | { kind: "time"; deal: Deal; startMin: number }
  /** A bar in the Week strip: moved by whole columns. */
  | { kind: "days"; deal: Deal; dayPx: number }
  /** A Timeline bar: along the hours, onto another row. `fromTechId` null = the Unassigned row. */
  | { kind: "tl-time"; deal: Deal; startMin: number; fromTechId: string | null }
  /** A Timeline Week bar: by whole days, onto another row. */
  | { kind: "tl-days"; deal: Deal; dayPx: number; fromTechId: string | null }
  /** A Month line: to the day it is dropped on. */
  | { kind: "month"; deal: Deal }
  /** An "Unscheduled jobs" card: where the pointer lets go. */
  | { kind: "card"; deal: Deal }
) & { startDate?: string };

/** What it can be dropped on. */
export type DropZone =
  | { kind: "day"; date: string }
  | { kind: "row"; axis: "time"; techId: string | null; date: string }
  | { kind: "row"; axis: "days"; techId: string | null; days: string[]; dayPx: number }
  | { kind: "cell"; date: string };

/** Where it lands: a day, maybe a start, maybe a row (`techId` undefined = the crew stays). */
export interface DropResult {
  date: string;
  startMin?: number;
  techId?: string | null;
}

const PX_PER_MIN = 88 / 60;
const TL_PX_PER_MIN = 70 / 60;

/**
 * Read a drop the way Workiz's calendar does: a job moves by as much as it
 * was dragged (snapped to the quarter hour, or to whole days), onto the
 * column, row or day under it; a card lands where the pointer let go.
 * `null` when it lands where it was, or off the calendar.
 */
export function resolveDrop(
  source: DragSource,
  zone: DropZone | null,
  delta: { x: number; y: number },
  pointer: { x: number; y: number } | null,
  zoneRect: { top: number; left: number } | null,
): DropResult | null {
  const deal = source.deal;
  const was = { date: source.startDate ?? deal.scheduledDate, tech: "fromTechId" in source ? source.fromTechId : undefined };
  const changed = (r: DropResult, startMin?: number) =>
    r.date !== was.date || r.startMin !== startMin || (r.techId !== undefined && r.techId !== was.tech) ? r : null;

  switch (source.kind) {
    case "time": {
      if (zone?.kind !== "day") return null;
      const startMin = snapMinutes(source.startMin + delta.y / PX_PER_MIN);
      return changed({ date: zone.date, startMin }, source.startMin);
    }
    case "days": {
      const shift = Math.round(delta.x / source.dayPx);
      if (!shift || !was.date) return null;
      return { date: addDays(was.date, shift) };
    }
    case "tl-time": {
      if (zone?.kind !== "row" || zone.axis !== "time") return null;
      const startMin = snapMinutes(source.startMin + delta.x / TL_PX_PER_MIN);
      return changed({ date: zone.date, startMin, techId: zone.techId }, source.startMin);
    }
    case "tl-days": {
      if (zone?.kind !== "row" || zone.axis !== "days" || !was.date) return null;
      const date = addDays(was.date, Math.round(delta.x / source.dayPx));
      return changed({ date, techId: zone.techId });
    }
    case "month": {
      if (zone?.kind !== "cell") return null;
      return changed({ date: zone.date });
    }
    case "card": {
      if (!zone) return null;
      if (zone.kind === "cell") return { date: zone.date };
      if (!pointer || !zoneRect) return null;
      if (zone.kind === "day") return { date: zone.date, startMin: snapMinutes((pointer.y - zoneRect.top) / PX_PER_MIN) };
      if (zone.axis === "time") {
        return { date: zone.date, startMin: snapMinutes((pointer.x - zoneRect.left) / TL_PX_PER_MIN), techId: zone.techId };
      }
      const i = Math.min(Math.max(Math.floor((pointer.x - zoneRect.left) / zone.dayPx), 0), zone.days.length - 1);
      return zone.days[i] ? { date: zone.days[i], techId: zone.techId } : null;
    }
  }
}

/**
 * An unscheduled job dropped on the calendar: that day, from where it landed
 * (9 AM on a day cell), as long as its job type's duration (Workiz; an hour
 * without one), held inside the day.
 *
 * Where it landed is on Connecticut's grid, saved on the clock of `zone`, the
 * one the job is booked in (2026-10-12 owner rule); a day cell has no hour,
 * so it gets 9 AM on the job's own clock.
 */
export function scheduleBody(
  date: string,
  startMin?: number,
  durationMinutes = 60,
  zone: string = DEFAULT_TZ,
): { scheduledDate: string; scheduledTimeSlot: string } {
  const at = startMin === undefined ? { date, time: "09:00" } : ctToZoneWall(date, hhmm(startMin), zone);
  const start = minutesOf(at.time);
  return { scheduledDate: at.date, scheduledTimeSlot: formatSlot(start, start + Math.max(durationMinutes, 1)) };
}

/** A drop waiting for its yes: the job, its new schedule, and the row change if any. */
export interface RescheduleTarget {
  deal: Deal;
  /** What the PUT sends — on the job's own clock. */
  body: MoveBody;
  /** The Timeline row it was dragged off (null = Unassigned); undefined when rows did not change. */
  fromTechId?: string | null;
  /** The Timeline row it was dropped on (null = Unassigned); undefined = the crew stays. */
  toTechId?: string | null;
  /** It was an unscheduled job, dragged in from the pane. */
  scheduling: boolean;
  /** The zone the job is booked in; Connecticut when left out. */
  zone?: string;
}

/**
 * A drop, read: the update it will send once confirmed. A job dropped from
 * Unscheduled is as long as its type's Duration (Workiz); everything dropped
 * on an hour goes back to the job's own clock (`moveBody`, `scheduleBody`).
 */
export function pendingMove(
  source: DragSource,
  drop: DropResult,
  { zone, durationMinutes }: { zone?: string; durationMinutes?: number },
): RescheduleTarget {
  const scheduling = source.kind === "card";
  return {
    deal: source.deal,
    body: scheduling ? scheduleBody(drop.date, drop.startMin, durationMinutes, zone) : moveBody(source.deal, drop, zone),
    fromTechId: "fromTechId" in source ? source.fromTechId : scheduling && drop.techId !== undefined ? null : undefined,
    toTechId: drop.techId,
    scheduling,
    zone,
  };
}
