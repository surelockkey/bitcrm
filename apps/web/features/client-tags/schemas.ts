import { z } from "zod";
import { JOB_TAG_COLORS } from "@bitcrm/types";

export const clientTagFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  color: z.enum(JOB_TAG_COLORS).default("slate"),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export type ClientTagFormValues = z.input<typeof clientTagFormSchema>;
export type ClientTagFormOutput = z.output<typeof clientTagFormSchema>;

/** Map validated form values to the create/update request body. */
export function toClientTagBody(values: ClientTagFormOutput) {
  return {
    name: values.name,
    color: values.color,
    priority: values.priority,
    active: values.active,
  };
}
