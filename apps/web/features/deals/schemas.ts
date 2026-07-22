import { z } from "zod";
import { ClientType, DealPriority, DealStage } from "@bitcrm/types";

export const addressSchema = z.object({
  street: z.string().trim().min(1, "Street is required"),
  unit: z.string().trim().optional(),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  zip: z.string().trim().min(1, "ZIP is required"),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const timeSlot = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, "Use HH:MM-HH:MM")
  .optional()
  .or(z.literal(""));

/** The job step of the New Deal wizard (contact/company come from step 1). */
export const dealJobSchema = z.object({
  clientType: z.nativeEnum(ClientType),
  jobTypeId: z.string().trim().min(1, "Pick a job type"),
  // Auto-resolved from the address by the backend; kept optional as a label override.
  serviceArea: z.string().trim().optional(),
  address: addressSchema,
  scheduledDate: z.string().trim().optional().or(z.literal("")),
  scheduledTimeSlot: timeSlot,
  priority: z.nativeEnum(DealPriority),
  sourceId: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1)),
});
export type DealJobValues = z.infer<typeof dealJobSchema>;

/** Edit form — same job fields plus internal notes; contact/stage/type immutable. */
export const editDealSchema = dealJobSchema
  .omit({ clientType: true })
  .extend({ internalNotes: z.string().trim().optional() });
export type EditDealValues = z.infer<typeof editDealSchema>;

/** API create body: a resolved contact + the job fields. */
export type CreateDealValues = DealJobValues & {
  contactId: string;
  companyId?: string;
};

/** API update body (subset of deal fields the PUT accepts). */
export type UpdateDealValues = Partial<
  Omit<DealJobValues, "clientType"> & { internalNotes: string }
>;

export const changeStageSchema = z.object({
  stage: z.nativeEnum(DealStage),
  cancellationReason: z.string().trim().optional(),
});

export const addProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  quantity: z.coerce.number().int().min(1, "At least 1"),
  costCompany: z.number(),
  costForTech: z.number(),
  priceClient: z.coerce.number().min(0),
});
export type AddProductValues = z.infer<typeof addProductSchema>;
