import { z } from "zod";

export const jobTypeFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export type JobTypeFormValues = z.input<typeof jobTypeFormSchema>;
export type JobTypeFormOutput = z.output<typeof jobTypeFormSchema>;

/** Map validated form values to the create/update request body. */
export function toJobTypeBody(values: JobTypeFormOutput) {
  return { name: values.name, priority: values.priority, active: values.active };
}
