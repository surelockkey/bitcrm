import { z } from "zod";

/** Live checklist rules shown under password fields. Matches the mockups. */
export function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    number: /[0-9]/.test(pw),
  };
}

/** New-password field: ≥8 chars, ≥1 uppercase, ≥1 number (superset of backend policy). */
const newPasswordField = z
  .string()
  .min(8, "At least 8 characters")
  .regex(/[A-Z]/, "One uppercase letter")
  .regex(/[0-9]/, "One number");

const passwordsMatch = <T extends { newPassword: string; confirmPassword: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const setPasswordSchema = passwordsMatch(
  z.object({
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, "Confirm your password"),
  }),
);

export const forgotSchema = z.object({
  email: z.string().email("Enter a valid email"),
});

export const resetConfirmSchema = passwordsMatch(
  z.object({
    email: z.string().email("Enter a valid email"),
    code: z.string().length(6, "Enter the 6-digit code"),
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, "Confirm your password"),
  }),
);

export type LoginValues = z.infer<typeof loginSchema>;
export type SetPasswordValues = z.infer<typeof setPasswordSchema>;
export type ForgotValues = z.infer<typeof forgotSchema>;
export type ResetConfirmValues = z.infer<typeof resetConfirmSchema>;
