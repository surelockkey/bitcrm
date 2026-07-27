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
  tagIds: z.array(z.string()).default([]),
  // Optional platinum / work-order fields.
  poNumber: z.string().trim().optional(),
  workOrderId: z.string().trim().optional(),
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

export const addProductSchema = z
  .object({
    // How the line is fulfilled. `sourced` pulls from a tech's van (deducts
    // stock); `to_order` is a part the tech doesn't carry; `service` is labor.
    fulfillment: z.enum(["sourced", "to_order", "service"]).default("sourced"),
    // Only sourced lines record which technician supplied the item.
    sourceTechId: z.string().optional(),
    productId: z.string(),
    name: z.string(),
    sku: z.string(),
    quantity: z.coerce.number().int().min(1, "At least 1"),
    costCompany: z.number(),
    costForTech: z.number(),
    priceClient: z.coerce.number().min(0),
  })
  .refine((v) => v.fulfillment !== "sourced" || !!v.sourceTechId, {
    message: "Pick a technician",
    path: ["sourceTechId"],
  });
export type AddProductValues = z.infer<typeof addProductSchema>;
