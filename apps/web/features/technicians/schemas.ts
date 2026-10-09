import { z } from "zod";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");

/** Profile edit — self-fill (contact/address) + manager operational fields.
 *  Address is captured as flat fields and reassembled into homeAddress.
 *  lat/lng are set by the address autocomplete and carry the technician onto the
 *  dispatch map; typed-by-hand addresses are geocoded server-side instead. */
export const profileSchema = z
  .object({
    // The user record's half: saved through the users API, only when changed.
    firstName: z.string().trim().max(80),
    lastName: z.string().trim().max(80),
    fieldTeamMember: z.boolean(),
    technicianType: z.enum(["regular", "subcontractor"]),
    phone: z.string().trim().max(30).optional(),
    additionalPhones: z.array(z.string().trim().max(30)).max(5),
    line1: z.string().trim().max(120).optional(),
    line2: z.string().trim().max(120).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(40).optional(),
    zip: z.string().trim().max(12).optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    laborCostPerHour: z.coerce.number().min(0, "Must be 0 or more").optional(),
    callMaskingEnabled: z.boolean(),
    gpsTrackingEnabled: z.boolean(),
    mobileAppInstalled: z.boolean(),
    status: z.enum(["pending", "active", "inactive"]),
    // The Availability tab — saved with the card, and only when touched: unset
    // hours dim nothing on the schedule, and a default must not become a value
    // just because the card was saved.
    workingDays: z.array(z.number().int().min(0).max(6)).optional(),
    workStart: hhmm.optional(),
    workEnd: hhmm.optional(),
  })
  .refine((v) => !v.workStart || !v.workEnd || v.workStart < v.workEnd, {
    path: ["workEnd"],
    message: "End must be after start",
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
