import { z } from "zod";
import { CUSTOM_FIELD_ENTITY_TYPES, CUSTOM_FIELD_TYPES, isOptionCustomFieldType } from "@bitcrm/types";

/**
 * One form for every field kind. `type` drives whether an `options` list is
 * meaningful: `dropdown`/`multi_select` require at least one option, every
 * other type carries none. `superRefine` enforces the requirement so submit
 * can stay disabled with a clear message; `transform` then forces options
 * empty for non-option types so a type switch can't leak stale choices.
 */
export const customFieldFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    type: z.enum(CUSTOM_FIELD_TYPES),
    group: z.string().default(""),
    options: z.array(z.string()).default([]),
    jobTypeIds: z.array(z.string()).default([]),
    required: z.boolean().default(false),
    requiredToClose: z.boolean().default(false),
    searchable: z.boolean().default(false),
    priority: z.coerce.number().int().min(0).default(0),
    active: z.boolean().default(true),
    /** Workiz's tab: a Job/Lead field or a Client field. */
    entityType: z.enum(CUSTOM_FIELD_ENTITY_TYPES).default("job"),
  })
  .superRefine((val, ctx) => {
    if (
      isOptionCustomFieldType(val.type) &&
      val.options.filter((o) => o.trim()).length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one option",
        path: ["options"],
      });
    }
  })
  .transform((val) => ({
    ...val,
    options: isOptionCustomFieldType(val.type) ? val.options : [],
  }));

export type CustomFieldFormValues = z.input<typeof customFieldFormSchema>;
export type CustomFieldFormOutput = z.output<typeof customFieldFormSchema>;

/**
 * Map validated form output to the create/update request body. No priority:
 * a field's place is set by dragging its row (Workiz), so an edit never moves
 * it, and a new one lands last. The tab (`entityType`) goes on create only —
 * it is fixed once the field exists.
 */
export function toCustomFieldBody(v: CustomFieldFormOutput, { editing = false }: { editing?: boolean } = {}) {
  return {
    name: v.name,
    type: v.type,
    group: v.group,
    options: v.options,
    jobTypeIds: v.jobTypeIds,
    required: v.required,
    requiredToClose: v.requiredToClose,
    searchable: v.searchable,
    active: v.active,
    ...(editing ? {} : { entityType: v.entityType }),
  };
}
