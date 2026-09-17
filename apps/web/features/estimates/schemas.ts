import { z } from "zod";
import { ProductType } from "@bitcrm/types";
import { isYmd } from "@/features/billing/dates";

export const newEstimateSchema = z.object({
  name: z.string().trim().max(120, "Keep the name under 120 characters").optional(),
  copyJobItems: z.boolean().default(false),
});
export type NewEstimateValues = z.infer<typeof newEstimateSchema>;

export const estimateHeaderSchema = z.object({
  name: z.string().trim().max(120, "Keep the name under 120 characters"),
  estimateDate: z.string().refine((v) => isYmd(v), "Pick a valid date"),
  notes: z.string().trim().max(5000, "Notes are too long"),
});
export type EstimateHeaderValues = z.infer<typeof estimateHeaderSchema>;

/** POST/PUT body of an estimate line. */
export const estimateItemSchema = z.object({
  productId: z.string().min(1),
  productType: z.nativeEnum(ProductType).optional(),
  name: z.string().min(1),
  sku: z.string(),
  description: z
    .string()
    .trim()
    .max(1000, "Keep the description under 1000 characters")
    .optional()
    .transform((v) => (v ? v : undefined)),
  quantity: z.coerce.number().int("Whole numbers only").min(1, "At least 1"),
  priceClient: z.coerce.number().min(0, "Price can't be negative"),
  costCompany: z.coerce.number().min(0),
  costForTech: z.coerce.number().min(0),
  taxable: z.boolean().optional(),
});
export type EstimateItemBody = z.output<typeof estimateItemSchema>;
