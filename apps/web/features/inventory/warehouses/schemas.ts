import { z } from "zod";

/** A warehouse is just a location record — only the name is required. */
export const warehouseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  address: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
});

export type WarehouseValues = z.infer<typeof warehouseSchema>;
