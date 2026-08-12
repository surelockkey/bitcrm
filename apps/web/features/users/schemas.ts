import { z } from "zod";
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

export const createUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Enter a valid email"),
  roleId: z.string().min(1, "Select a role"),
  department: z.string().min(1, "Department is required"),
  phone,
});

export const updateUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  department: z.string().min(1, "Department is required"),
  phone,
});

export type CreateUserValues = z.infer<typeof createUserSchema>;
export type UpdateUserValues = z.infer<typeof updateUserSchema>;
