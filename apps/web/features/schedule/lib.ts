import {
  CalendarEventType,
  type CalendarEvent,
  type Deal,
  type TechnicianProfile,
} from "@bitcrm/types";
import type { DirectoryUser } from "@/features/deals/hooks";

/** The manager-controlled working-hours subset of a technician profile. */
export interface WorkingHours {
  workingDays?: number[];
  workStart?: string;
  workEnd?: string;
}

function parseISO(dateISO: string): number {
  return Date.parse(`${dateISO}T00:00:00Z`);
}

/** Day of week for an ISO date in UTC terms: 0=Sun … 6=Sat. */
export function dayOfWeek(dateISO: string): number {
  return new Date(parseISO(dateISO)).getUTCDay();
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

/**
 * A technician's hours off on a day, in minutes since midnight: the whole day
 * on a day they do not work, else before their start and after their end.
 * Nothing when their working hours are unset (opt-in).
 */
export function outOfHoursRanges(wh: WorkingHours, dateISO: string): [number, number][] {
  if (!wh.workingDays || !wh.workStart || !wh.workEnd) return [];
  if (!wh.workingDays.includes(dayOfWeek(dateISO))) return [[0, 1440]];
  const start = parseSlot(`${wh.workStart}-${wh.workStart}`)?.start ?? 0;
  const end = parseSlot(`${wh.workEnd}-${wh.workEnd}`)?.start ?? 1440;
  const out: [number, number][] = [];
  if (start > 0) out.push([0, start]);
  if (end < 1440) out.push([end, 1440]);
  return out;
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

export interface TechFilter {
  activeOnly: boolean;
  department?: string;
  query?: string;
}

/** Filter the technician roster for the schedule toolbar (status/department/name). */
export function filterTechnicians(
  profiles: TechnicianProfile[],
  users: Map<string, DirectoryUser & { fieldTeamMember?: boolean }>,
  filter: TechFilter,
): TechnicianProfile[] {
  const q = filter.query?.trim().toLowerCase();
  return profiles.filter((p) => {
    if (filter.activeOnly && p.status !== "active") return false;
    const u = users.get(p.userId);
    // Switched off the field team: the profile is still theirs (address,
    // hours), but nothing can be put on a column for someone who no longer
    // goes out on jobs. Only an explicit off — a profile exists because they
    // were on the team when it was made.
    if (u?.fieldTeamMember === false) return false;
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
