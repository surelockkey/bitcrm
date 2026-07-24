import { z } from "zod";
import { CalendarEventType } from "@bitcrm/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const timeSlot = z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, "Use HH:MM-HH:MM");

/**
 * Time-off / lunch / break form. Mirrors the backend coherence rules:
 * all-day ⇒ no slot (may span days); timed ⇒ single day with a slot.
 */
export const calendarEventSchema = z
  .object({
    type: z.nativeEnum(CalendarEventType),
    title: z.string().trim().min(1, "Add a title").max(200),
    startDate: isoDate,
    endDate: isoDate,
    allDay: z.boolean(),
    timeSlot: timeSlot.optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End is before start" });
    }
    if (v.allDay) {
      if (v.timeSlot) {
        ctx.addIssue({ code: "custom", path: ["timeSlot"], message: "All-day events have no time" });
      }
    } else {
      if (v.endDate !== v.startDate) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "Timed events are a single day" });
      }
      if (!v.timeSlot) {
        ctx.addIssue({ code: "custom", path: ["timeSlot"], message: "Add a time range" });
      }
    }
  });

export type CalendarEventValues = z.infer<typeof calendarEventSchema>;

/** The API body (empty slot coerced to undefined). */
export interface CalendarEventInput {
  type: CalendarEventType;
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  timeSlot?: string;
}

export function toEventInput(v: CalendarEventValues): CalendarEventInput {
  return {
    type: v.type,
    title: v.title.trim(),
    startDate: v.startDate,
    endDate: v.allDay ? v.endDate : v.startDate,
    allDay: v.allDay,
    timeSlot: v.allDay ? undefined : v.timeSlot || undefined,
  };
}

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");

export const workingHoursSchema = z
  .object({
    workingDays: z.array(z.number().int().min(0).max(6)),
    workStart: hhmm,
    workEnd: hhmm,
  })
  .refine((v) => v.workStart < v.workEnd, {
    path: ["workEnd"],
    message: "End must be after start",
  });

export type WorkingHoursValues = z.infer<typeof workingHoursSchema>;
