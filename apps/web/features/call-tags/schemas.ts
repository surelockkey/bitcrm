import { z } from "zod";
import { CALL_TAG_LIMITS, JOB_TAG_COLORS } from "@bitcrm/types";
import type { CallTagValues } from "./api";

/**
 * The call-tag form. Mirrors what `CallTagsService` validates by hand
 * (telephony registers no ValidationPipe), so a bad value is caught before it
 * becomes a 400: non-empty name within the length cap, a palette color, a
 * non-negative integer priority.
 */
export const callTagFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(
      CALL_TAG_LIMITS.nameMaxLength,
      `Name must be at most ${CALL_TAG_LIMITS.nameMaxLength} characters`,
    ),
  color: z.enum(JOB_TAG_COLORS).default("slate"),
  priority: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export type CallTagFormValues = z.input<typeof callTagFormSchema>;
export type CallTagFormOutput = z.output<typeof callTagFormSchema>;

/** Map validated form values to the create/update request body. */
export function toCallTagBody(values: CallTagFormOutput): CallTagValues {
  return {
    name: values.name,
    color: values.color,
    priority: values.priority,
    active: values.active,
  };
}
