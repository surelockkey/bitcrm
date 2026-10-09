import { JobSuperStatus, type CalendarEvent, type Deal } from "@bitcrm/types";
import { WZ_DEFAULT_EVENT_COLOR, scheduleColor, scheduleItem, scheduleText } from "./calendar";
import { dealConflicts, eventLabel, eventOnDate, parseSlot, type WorkingHours } from "./lib";

/** One thing on the calendar: a job, or a technician's time off. */
export interface CalendarEntry {
  /** The deal id, or `off:<event id>`. */
  id: string;
  kind: "job" | "off";
  deal?: Deal;
  startDate: string;
  endDate: string;
  startMin: number;
  endMin: number;
  /** A bar (all day, several days) rather than a box in the hours. */
  bar: boolean;
  /** The box's heading: "Job ID: X". */
  title: string;
  /** The words: the Workiz template for a job; "Time off: Dentist - Sam Reyes". */
  text: string;
  color: string;
  done: boolean;
  /** The Timeline rows it sits on; none = the Unassigned row. */
  techIds: string[];
  /** Overlaps another job, time off, or falls outside working hours (our warning). */
  conflict: boolean;
}

export interface EntryContext {
  jobTypeName: (id: string) => string;
  techName: (id: string) => string;
  profiles: Map<string, WorkingHours>;
  /** A service area's stored `#rrggbb` by its name (the name is what a job carries). */
  areaColor?: (name: string) => string | undefined;
}

/**
 * The calendar's entries: each dated job worded by this account's Workiz
 * template and coloured by its service area (its stored colour, else one its
 * name picks), Done ones striped; each time off
 * in Workiz's default event colour on its technician's row.
 */
export function buildEntries(deals: Deal[], events: CalendarEvent[], ctx: EntryContext): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const deal of deals) {
    const item = scheduleItem(deal);
    if (!item) continue;
    const conflict = deal.assignedTechIds.some((tech) => {
      const sameTech = deals.filter((d) => d.scheduledDate === deal.scheduledDate && d.assignedTechIds.includes(tech));
      const techEvents = events.filter(
        (e) => e.technicianId === tech && deal.scheduledDate && eventOnDate(e, deal.scheduledDate),
      );
      return dealConflicts(deal, sameTech, techEvents, ctx.profiles.get(tech) ?? {}).length > 0;
    });
    out.push({
      id: deal.id,
      kind: "job",
      deal,
      startDate: item.startDate,
      endDate: item.endDate,
      startMin: item.startMin,
      endMin: item.endMin,
      bar: item.bar,
      title: `Job ID: ${deal.dealNumber}`,
      text: scheduleText(deal, {
        jobType: ctx.jobTypeName(deal.jobTypeId),
        techs: deal.assignedTechIds.map(ctx.techName).filter(Boolean),
      }),
      color: scheduleColor(deal.serviceArea, ctx.areaColor?.(deal.serviceArea)),
      done: deal.superStatus === JobSuperStatus.DONE,
      techIds: deal.assignedTechIds,
      conflict,
    });
  }
  for (const ev of events) {
    const slot = ev.allDay ? null : parseSlot(ev.timeSlot);
    const label = eventLabel(ev.type);
    const who = ctx.techName(ev.technicianId);
    out.push({
      id: `off:${ev.id}`,
      kind: "off",
      startDate: ev.startDate,
      endDate: ev.endDate,
      startMin: slot?.start ?? 0,
      endMin: slot?.end ?? 1440,
      bar: !slot || ev.endDate !== ev.startDate,
      title: label,
      text: `${label}${ev.title ? `: ${ev.title}` : ""}${who ? ` - ${who}` : ""}`,
      color: WZ_DEFAULT_EVENT_COLOR,
      done: false,
      techIds: [ev.technicianId],
      conflict: false,
    });
  }
  return out;
}
