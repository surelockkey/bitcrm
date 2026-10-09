import { z } from "zod";
import type { CreateUserRequest } from "@bitcrm/types";
import { isValidPhone } from "@/lib/phone";

/**
 * Optional, but must be dialable when given — the call log matches it against
 * real call endpoints, so a half-typed number would simply never match.
 */
const phone = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidPhone(v), "Enter a valid phone number")
  .optional();

/**
 * Workiz's "Add team member": a User (invited, signs in, has a role) or a
 * Subcontractor ("Can not login, can take jobs and get messages" — and
 * "Roles are not available for subcontractors", so none is asked for).
 */
export const createUserSchema = z
  .object({
    userType: z.enum(["regular", "subcontractor"]).default("regular"),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Enter a valid email"),
    roleId: z.string(),
    department: z.string().min(1, "Department is required"),
    phone,
  })
  .superRefine((v, ctx) => {
    if (v.userType !== "subcontractor" && !v.roleId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["roleId"], message: "Select a role" });
    }
  });

export const updateUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  department: z.string().min(1, "Department is required"),
  phone,
  /** Workiz "Field team member": on or off the roster that may be put on a job. Omitted = unchanged. */
  fieldTeamMember: z.boolean().optional(),
});

export type CreateUserValues = z.input<typeof createUserSchema>;

/**
 * The request a filled-in form becomes. A User goes as it always has (the
 * role, no type); a subcontractor goes typed and without a role — the API
 * gives them the technician's.
 */
export function toCreateUserRequest(values: CreateUserValues): CreateUserRequest {
  const { userType, roleId, ...rest } = values;
  return userType === "subcontractor" ? { ...rest, userType: "subcontractor" } : { ...rest, roleId };
}
export type UpdateUserValues = z.infer<typeof updateUserSchema>;
