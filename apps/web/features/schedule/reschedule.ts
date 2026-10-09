import type { Deal } from "@bitcrm/types";
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

/**
 * The update a drop sends: the job's new first day (its last day moving with
 * it) and, when it was dropped on an hour, its new start — the same length as
 * before. An all-day job only moves by days.
 */
export function moveBody(deal: Deal, { date, startMin }: { date: string; startMin?: number }): MoveBody {
  const from = deal.scheduledDate ?? date;
  const span = deal.scheduledEndDate && deal.scheduledEndDate > from ? daysBetween(from, deal.scheduledEndDate) : 0;
  const body: MoveBody = { scheduledDate: date };
  if (span > 0) body.scheduledEndDate = addDays(date, span);
  const slot = deal.allDay ? null : parseSlot(deal.scheduledTimeSlot);
  if (!slot) return body;
  if (startMin === undefined || span > 0) {
    body.scheduledTimeSlot = deal.scheduledTimeSlot;
    return body;
  }
  body.scheduledTimeSlot = formatSlot(startMin, startMin + Math.max(slot.end - slot.start, 0));
  return body;
}

/* ------------------------------------------------------------ the drop */

/** What is being dragged, and how its move is read. */
export type DragSource =
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
  | { kind: "card"; deal: Deal };

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
  const was = { date: deal.scheduledDate, tech: "fromTechId" in source ? source.fromTechId : undefined };
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
      if (!shift || !deal.scheduledDate) return null;
      return { date: addDays(deal.scheduledDate, shift) };
    }
    case "tl-time": {
      if (zone?.kind !== "row" || zone.axis !== "time") return null;
      const startMin = snapMinutes(source.startMin + delta.x / TL_PX_PER_MIN);
      return changed({ date: zone.date, startMin, techId: zone.techId }, source.startMin);
    }
    case "tl-days": {
      if (zone?.kind !== "row" || zone.axis !== "days" || !deal.scheduledDate) return null;
      const date = addDays(deal.scheduledDate, Math.round(delta.x / source.dayPx));
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

/** An unscheduled job dropped on the calendar: that day, an hour from where it landed (9 AM on a day cell). */
export function scheduleBody(date: string, startMin = 9 * 60): { scheduledDate: string; scheduledTimeSlot: string } {
  return { scheduledDate: date, scheduledTimeSlot: formatSlot(startMin, startMin + 60) };
}
