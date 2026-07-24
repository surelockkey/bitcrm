import {
  CalendarEventType,
  type CalendarEvent,
  type Deal,
  type TechnicianProfile,
  type User,
} from "@bitcrm/types";

/** Vertical grid geometry for the day view. */
export interface Grid {
  /** First hour shown (24h). */
  startHour: number;
  /** Last hour shown (exclusive upper edge, 24h). */
  endHour: number;
  /** Pixels per hour row. */
  hourPx: number;
  /** Shortest a block may render, so 10-minute jobs stay legible. */
  minBlockPx: number;
}

/** The manager-controlled working-hours subset of a technician profile. */
export interface WorkingHours {
  workingDays?: number[];
  workStart?: string;
  workEnd?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseISO(dateISO: string): number {
  return Date.parse(`${dateISO}T00:00:00Z`);
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Day of week for an ISO date in UTC terms: 0=Sun … 6=Sat. */
export function dayOfWeek(dateISO: string): number {
  return new Date(parseISO(dateISO)).getUTCDay();
}

/** The Mon..Sun week (7 ISO dates) containing `anchorISO`. */
export function weekDays(anchorISO: string): string[] {
  const dow = dayOfWeek(anchorISO); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow; // Sunday belongs to the week that just ended
  const monday = parseISO(anchorISO) + mondayOffset * MS_PER_DAY;
  return Array.from({ length: 7 }, (_, i) => toISO(monday + i * MS_PER_DAY));
}

/** "HH:MM-HH:MM" → minutes since midnight, or null when malformed. */
export function parseSlot(slot?: string): { start: number; end: number } | null {
  if (!slot) return null;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(slot);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return { start, end };
}

export function slotMinutes(slot: string): number {
  const p = parseSlot(slot);
  return p ? p.end - p.start : 0;
}

/** Half-open overlap: back-to-back slots (12:00 ends, 12:00 starts) don't conflict. */
export function slotsOverlap(a?: string, b?: string): boolean {
  const pa = parseSlot(a);
  const pb = parseSlot(b);
  if (!pa || !pb) return false;
  return pa.start < pb.end && pb.start < pa.end;
}

/** Top offset + height (px) for a slot within the grid, clamped to a minimum. */
export function blockGeometry(slot: string, grid: Grid): { topPx: number; heightPx: number } {
  const p = parseSlot(slot) ?? { start: grid.startHour * 60, end: grid.startHour * 60 };
  const gridStart = grid.startHour * 60;
  const pxPerMin = grid.hourPx / 60;
  const topPx = (p.start - gridStart) * pxPerMin;
  const heightPx = Math.max(grid.minBlockPx, (p.end - p.start) * pxPerMin);
  return { topPx, heightPx };
}

export interface DayBlock {
  deal: Deal;
  topPx: number;
  heightPx: number;
  /** How many later, time-overlapping jobs are folded behind this one (the +N pill). */
  overflowCount: number;
}

export interface DayColumnLayout {
  /** Rendered blocks (one per overlap cluster; earliest wins). */
  blocks: DayBlock[];
  /** Jobs folded into a `+N` pill on their cluster's block. */
  hidden: Deal[];
  /** Scheduled-date jobs with no time slot — shown in a tray, not the grid. */
  unscheduled: Deal[];
}

/**
 * Lay out a technician's day. Overlapping jobs collapse to a single block with a
 * `+N` pill rather than shrinking side-by-side — the readability rule that keeps
 * this from looking like the old Workiz calendar.
 */
export function layoutDayColumn(deals: Deal[], grid: Grid): DayColumnLayout {
  const unscheduled = deals.filter((d) => !parseSlot(d.scheduledTimeSlot));
  const timed = deals
    .filter((d) => parseSlot(d.scheduledTimeSlot))
    .sort((a, b) => (a.scheduledTimeSlot! < b.scheduledTimeSlot! ? -1 : 1));

  const blocks: DayBlock[] = [];
  const hidden: Deal[] = [];
  let cluster: Deal[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const [lead, ...rest] = cluster;
    const geo = blockGeometry(lead.scheduledTimeSlot!, grid);
    blocks.push({ deal: lead, ...geo, overflowCount: rest.length });
    hidden.push(...rest);
    cluster = [];
    clusterEnd = -1;
  };

  for (const d of timed) {
    const p = parseSlot(d.scheduledTimeSlot)!;
    if (cluster.length && p.start < clusterEnd) {
      cluster.push(d);
      clusterEnd = Math.max(clusterEnd, p.end);
    } else {
      flush();
      cluster = [d];
      clusterEnd = p.end;
    }
  }
  flush();

  return { blocks, hidden, unscheduled };
}

/** Dimmed rectangles for out-of-hours / non-working portions of a day column. */
export function outOfHoursBands(
  wh: WorkingHours,
  dateISO: string,
  grid: Grid,
): { topPx: number; heightPx: number }[] {
  if (!wh.workingDays || !wh.workStart || !wh.workEnd) return [];

  const fullHeight = (grid.endHour - grid.startHour) * grid.hourPx;
  if (!wh.workingDays.includes(dayOfWeek(dateISO))) {
    return [{ topPx: 0, heightPx: fullHeight }];
  }

  const pxPerMin = grid.hourPx / 60;
  const gridStart = grid.startHour * 60;
  const gridEnd = grid.endHour * 60;
  const start = parseSlot(`${wh.workStart}-${wh.workStart}`)?.start ?? gridStart;
  const end = parseSlot(`${wh.workEnd}-${wh.workEnd}`)?.start ?? gridEnd;

  const bands: { topPx: number; heightPx: number }[] = [];
  if (start > gridStart) {
    bands.push({ topPx: 0, heightPx: (start - gridStart) * pxPerMin });
  }
  if (end < gridEnd) {
    bands.push({ topPx: (end - gridStart) * pxPerMin, heightPx: (gridEnd - end) * pxPerMin });
  }
  return bands;
}

/** Whether an event's inclusive [startDate,endDate] span covers a date. */
export function eventOnDate(event: CalendarEvent, dateISO: string): boolean {
  return event.startDate <= dateISO && dateISO <= event.endDate;
}

export type ConflictReason = "double_booked" | "time_off" | "out_of_hours";

/**
 * Why a deal's slot is problematic for its technician on its scheduled day:
 * overlapping another job, hitting a time-off/lunch block, or falling outside
 * the tech's working hours. Empty ⇒ clean. Warnings only — never a hard block.
 */
export function dealConflicts(
  deal: Deal,
  sameTechDeals: Deal[],
  events: CalendarEvent[],
  wh: WorkingHours,
): ConflictReason[] {
  const reasons: ConflictReason[] = [];
  const slot = deal.scheduledTimeSlot;
  const date = deal.scheduledDate;
  if (!slot || !date) return reasons;

  if (sameTechDeals.some((o) => o.id !== deal.id && slotsOverlap(slot, o.scheduledTimeSlot)))
    reasons.push("double_booked");

  const dayEvents = events.filter((e) => eventOnDate(e, date));
  if (dayEvents.some((e) => e.allDay || slotsOverlap(slot, e.timeSlot)))
    reasons.push("time_off");

  if (wh.workingDays && wh.workStart && wh.workEnd) {
    const p = parseSlot(slot)!;
    const start = parseSlot(`${wh.workStart}-${wh.workStart}`)!.start;
    const end = parseSlot(`${wh.workEnd}-${wh.workEnd}`)!.start;
    if (!wh.workingDays.includes(dayOfWeek(date)) || p.start < start || p.end > end)
      reasons.push("out_of_hours");
  }
  return reasons;
}

/** Default day window, always shown; the grid only ever grows past it. */
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 19;

/**
 * The hour window a day column should span: the [7,19] baseline, widened to fit
 * any job or working-hours boundary that falls outside it that day. This is why
 * the grid is no longer stuck at 7–18 — an early or late job pulls it open.
 */
export function computeDayWindow(
  deals: Deal[],
  profiles: Map<string, TechnicianProfile>,
  dateISO: string,
): { startHour: number; endHour: number } {
  let minStart = DEFAULT_START_HOUR * 60;
  let maxEnd = DEFAULT_END_HOUR * 60;

  for (const d of deals) {
    if (d.scheduledDate !== dateISO) continue;
    const p = parseSlot(d.scheduledTimeSlot);
    if (!p) continue;
    minStart = Math.min(minStart, p.start);
    maxEnd = Math.max(maxEnd, p.end);
  }
  for (const prof of profiles.values()) {
    const start = parseSlot(`${prof.workStart}-${prof.workStart}`);
    const end = parseSlot(`${prof.workEnd}-${prof.workEnd}`);
    if (start) minStart = Math.min(minStart, start.start);
    if (end) maxEnd = Math.max(maxEnd, end.start);
  }

  return {
    startHour: Math.max(0, Math.floor(minStart / 60)),
    endHour: Math.min(24, Math.ceil(maxEnd / 60)),
  };
}

export interface TechFilter {
  activeOnly: boolean;
  department?: string;
  query?: string;
}

/** Filter the technician roster for the schedule toolbar (status/department/name). */
export function filterTechnicians(
  profiles: TechnicianProfile[],
  users: Map<string, User>,
  filter: TechFilter,
): TechnicianProfile[] {
  const q = filter.query?.trim().toLowerCase();
  return profiles.filter((p) => {
    if (filter.activeOnly && p.status !== "active") return false;
    const u = users.get(p.userId);
    if (filter.department && u?.department !== filter.department) return false;
    if (q) {
      const name = `${u?.firstName ?? ""} ${u?.lastName ?? ""} ${u?.email ?? ""}`.toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });
}

const EVENT_LABELS: Record<CalendarEventType, string> = {
  [CalendarEventType.TIME_OFF]: "Time off",
  [CalendarEventType.BREAK]: "Break",
  [CalendarEventType.LUNCH]: "Lunch",
  [CalendarEventType.APPOINTMENT]: "Appointment",
};

export function eventLabel(type: CalendarEventType): string {
  return EVENT_LABELS[type] ?? type;
}
