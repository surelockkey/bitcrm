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
  /** Default `taxable` flag copied onto job/estimate lines (absent ⇒ true). */
  taxable: z.boolean().default(true),
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
/** A PUT body carrying only the fields the user actually changed. */
export type PatchProductValues = Partial<UpdateProductValues>;

/* ------------------------------------------------------------------ *
 * Editing an imported item
 * ------------------------------------------------------------------ */

/**
 * Caps the create form enforces but imported data does not meet. Workiz has
 * 262 item names over 120 chars, 144 descriptions over 1000, 10 serials over
 * 64 and 61 items priced below 0 — none of them can be created here, but all
 * of them must stay editable once the importer has written them.
 */
const CAPS = {
  name: 120,
  barcode: 64,
  description: 1000,
  category: 120,
  supplier: 120,
} as const;

const MONEY_FIELDS = ["costCompany", "costTech", "priceClient"] as const;

/** Same shape, without the caps — they are re-applied per field below. */
const looseFields = {
  name: z.string().trim().min(1, "Name is required"),
  barcode: z.string().trim().optional(),
  description: z.string().trim().optional(),
  category: z.string().trim().min(1, "Category is required"),
  type: z.nativeEnum(ProductType),
  costCompany: z.coerce.number({ message: "Enter an amount" }),
  costTech: z.coerce.number({ message: "Enter an amount" }),
  priceClient: z.coerce.number({ message: "Enter an amount" }),
  supplier: z.string().trim().optional(),
  serialTracking: z.boolean(),
  minimumStockLevel: z.coerce.number({ message: "Enter a number" }).int("Whole number"),
};

/**
 * Edit schema that validates only what the request changes.
 *
 * Every rule of `updateProductSchema` still applies to a field the user
 * touched; a field left exactly as the server returned it is accepted even
 * when it breaks a cap. So an imported item with a 262-character name or a
 * negative price opens, renders, and can have its category fixed — instead of
 * a form that can never be submitted (and a 400 from the API, which validates
 * only the fields present in the body).
 *
 * `original` is the stored product. Pass nothing for the strict behaviour.
 */
export function updateProductSchemaFor(original?: Partial<UpdateProductValues>) {
  const keptString = (field: keyof typeof CAPS, value: string): boolean =>
    typeof original?.[field] === "string" &&
    (original[field] as string).trim() === value;

  return z.object(looseFields).superRefine((v, ctx) => {
    for (const [field, max] of Object.entries(CAPS) as [keyof typeof CAPS, number][]) {
      const value = v[field];
      if (typeof value !== "string" || value.length <= max) continue;
      if (keptString(field, value)) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: max,
        type: "string",
        inclusive: true,
        path: [field],
        message: `Must be ${max} characters or fewer`,
      });
    }

    for (const field of MONEY_FIELDS) {
      if (v[field] >= 0 || original?.[field] === v[field]) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 0,
        type: "number",
        inclusive: true,
        path: [field],
        message: "Must be 0 or more",
      });
    }

    if (v.minimumStockLevel < 0 && original?.minimumStockLevel !== v.minimumStockLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 0,
        type: "number",
        inclusive: true,
        path: ["minimumStockLevel"],
        message: "Must be 0 or more",
      });
    }
  });
}
