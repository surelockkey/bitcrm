import { z } from "zod";
import { ProductType } from "@bitcrm/types";

/** Money fields are plain decimal dollars (backend stores floats, not cents). */
const money = z.coerce
  .number({ message: "Enter an amount" })
  .min(0, "Must be 0 or more");

const baseFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  barcode: z.string().trim().max(64).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().min(1, "Category is required").max(120),
  type: z.nativeEnum(ProductType),
  costCompany: money,
  costTech: money,
  priceClient: money,
  supplier: z.string().trim().max(120).optional(),
  serialTracking: z.boolean(),
  minimumStockLevel: z.coerce
    .number({ message: "Enter a number" })
    .int("Whole number")
    .min(0, "Must be 0 or more"),
};

/** Create requires a SKU (unique, immutable once set). */
export const createProductSchema = z.object({
  ...baseFields,
  sku: z.string().trim().min(1, "SKU is required").max(64),
});

/** Update omits SKU — the backend ignores changes to it. */
export const updateProductSchema = z.object(baseFields);

export type CreateProductValues = z.infer<typeof createProductSchema>;
export type UpdateProductValues = z.infer<typeof updateProductSchema>;
