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
 * Workiz's "Add team member" asks one "Name"; our record keeps first and
 * last apart, so the box splits on the first space — the first word is the
 * first name, the rest the last — as the New Job client name does.
 */
export function splitFullName(name: string): { firstName: string; lastName: string } {
  const [firstName = "", ...rest] = name.trim().split(/\s+/).filter(Boolean);
  return { firstName, lastName: rest.join(" ") };
}

/**
 * Workiz's "Add team member": a User (invited, signs in, has a "Permission
 * level", answers "Field tech" and "Track Location" — Yes and Yes to begin
 * with, as Workiz opens) or a Subcontractor ("Can not login, can take jobs
 * and get messages" — "Roles are not available for subcontractors", so none
 * is asked for, and the API puts them on the field team untracked).
 */
export const createUserSchema = z
  .object({
    userType: z.enum(["regular", "subcontractor"]).default("regular"),
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .refine((v) => splitFullName(v).lastName.length > 0, "Enter first and last name"),
    email: z.string().email("Enter a valid email"),
    phone,
    roleId: z.string(),
    fieldTeamMember: z.boolean().default(true),
    gpsTrackingEnabled: z.boolean().default(true),
    department: z.string().min(1, "Department is required"),
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
 * The request a filled-in form becomes. A User goes with the role, the split
 * name and both answers (no type); a subcontractor goes typed and without a
 * role, Field tech or Track Location — the API gives them the technician's
 * role, the field team and no tracking.
 */
export function toCreateUserRequest(values: CreateUserValues): CreateUserRequest {
  const { userType, name, email, department, phone: rawPhone, roleId, fieldTeamMember, gpsTrackingEnabled } = values;
  const { firstName, lastName } = splitFullName(name);
  const base = { email, firstName, lastName, department, ...(rawPhone ? { phone: rawPhone } : {}) };
  return userType === "subcontractor"
    ? { ...base, userType: "subcontractor" }
    : { ...base, roleId, fieldTeamMember: fieldTeamMember ?? true, gpsTrackingEnabled: gpsTrackingEnabled ?? true };
}
export type UpdateUserValues = z.infer<typeof updateUserSchema>;
