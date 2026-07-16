import { z } from "zod";

/**
 * Client-side validation for role metadata. The backend enforces uniqueness
 * (409) and `priority >= 1` but sets no length/format rules — these limits are
 * the UI's own sensible guardrails. Priority is capped below 100 (Super Admin).
 */
export const roleDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(40, "Keep the name under 40 characters"),
  description: z
    .string()
    .trim()
    .max(160, "Keep the description under 160 characters")
    .optional(),
  priority: z
    .number({ message: "Priority is required" })
    .int("Priority must be a whole number")
    .min(1, "Priority must be at least 1")
    .max(99, "Priority must be below 100 (Super Admin)"),
});

export type RoleDetailsValues = z.infer<typeof roleDetailsSchema>;

/** Create flow: metadata + the role to clone the matrix/scope/transitions from. */
export const createRoleSchema = roleDetailsSchema.extend({
  startFromRoleId: z.string().min(1, "Pick a role to start from"),
});

export type CreateRoleValues = z.infer<typeof createRoleSchema>;
