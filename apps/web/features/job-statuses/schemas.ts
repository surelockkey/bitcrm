import { z } from "zod";
import { JOB_TAG_COLORS, DealStageGroup } from "@bitcrm/types";

/**
 * A job sub-status form: a colored label filed under a fixed super-status
 * (DealStageGroup). Reuses the shared color palette (JOB_TAG_COLORS).
 */
export const jobStatusFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  group: z.nativeEnum(DealStageGroup),
  color: z.enum(JOB_TAG_COLORS).default("slate"),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export type JobStatusFormValues = z.input<typeof jobStatusFormSchema>;
export type JobStatusFormOutput = z.output<typeof jobStatusFormSchema>;

/** Map validated form values to the create/update request body. */
export function toJobStatusBody(values: JobStatusFormOutput) {
  return {
    name: values.name,
    group: values.group,
    color: values.color,
    priority: values.priority,
    active: values.active,
  };
}
