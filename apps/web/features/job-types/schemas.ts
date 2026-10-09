import { z } from "zod";
import { joinDuration } from "./lib";

/**
 * The Add / Edit Job Type form: the name, the order, and Workiz's Duration
 * as its three boxes — Days 0–31, Hours 0–23, Minutes 0–59
 * (feat_job_rules_wz_jobtype_{days,hours,minutes}_open).
 */
export const jobTypeFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
  days: z.coerce.number().int().min(0).max(31).default(0),
  hours: z.coerce.number().int().min(0).max(23).default(0),
  minutes: z.coerce.number().int().min(0).max(59).default(0),
});

export type JobTypeFormValues = z.input<typeof jobTypeFormSchema>;
export type JobTypeFormOutput = z.output<typeof jobTypeFormSchema>;

/** Map validated form values to the create/update request body: the three boxes as one `durationMinutes`. */
export function toJobTypeBody(values: JobTypeFormOutput) {
  return {
    name: values.name,
    priority: values.priority,
    active: values.active,
    durationMinutes: joinDuration({ days: values.days, hours: values.hours, minutes: values.minutes }),
  };
}
