import { z } from "zod";

/** Profile edit — self-fill (contact/address) + manager operational fields.
 *  Address is captured as flat fields and reassembled into homeAddress. */
export const profileSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  line1: z.string().trim().max(120).optional(),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(12).optional(),
  laborCostPerHour: z.coerce.number().min(0, "Must be 0 or more").optional(),
  callMaskingEnabled: z.boolean(),
  gpsTrackingEnabled: z.boolean(),
  mobileAppInstalled: z.boolean(),
  status: z.enum(["pending", "active", "inactive"]),
});
export type ProfileValues = z.infer<typeof profileSchema>;

const pct = z.coerce
  .number({ message: "Enter a percentage" })
  .min(0, "Min 0%")
  .max(100, "Max 100%");

export const commissionSchema = z.object({
  baseRatePct: pct,
  creditCardFeePct: pct.optional(),
  achFeePct: pct.optional(),
  effectiveDate: z.string().optional(),
});
export type CommissionValues = z.infer<typeof commissionSchema>;

export const sensitiveSchema = z.object({
  ssn: z
    .string()
    .trim()
    .regex(/^\d{3}-?\d{2}-?\d{4}$/, "Enter a valid SSN")
    .optional()
    .or(z.literal("")),
  bankAccount: z
    .string()
    .trim()
    .regex(/^\d{4,17}$/, "4–17 digits")
    .optional()
    .or(z.literal("")),
});
export type SensitiveValues = z.infer<typeof sensitiveSchema>;
