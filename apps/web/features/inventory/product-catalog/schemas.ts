import { z } from "zod";

export const brandFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().default(""),
});

export type BrandFormOutput = z.output<typeof brandFormSchema>;

export const productCategoryFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().default(""),
  /** Empty string means top-level — the request omits `parentId` entirely. */
  parentId: z.string().default(""),
});

export type ProductCategoryFormOutput = z.output<typeof productCategoryFormSchema>;

export function toBrandBody(values: BrandFormOutput) {
  return { name: values.name, description: values.description };
}

export function toProductCategoryBody(values: ProductCategoryFormOutput) {
  return {
    name: values.name,
    description: values.description,
    ...(values.parentId ? { parentId: values.parentId } : {}),
  };
}
