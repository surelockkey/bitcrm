import { z } from "zod";

export const jobSourceFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export type JobSourceFormValues = z.input<typeof jobSourceFormSchema>;
export type JobSourceFormOutput = z.output<typeof jobSourceFormSchema>;

/** Map validated form values to the create/update request body. */
export function toJobSourceBody(values: JobSourceFormOutput) {
  return { name: values.name, priority: values.priority, active: values.active };
}
