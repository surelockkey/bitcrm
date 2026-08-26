import { z } from "zod";

/** A container is a mobile stock location — only the name is required. */
export const containerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional(),
  department: z.string().trim().max(100).optional(),
});

export type ContainerValues = z.infer<typeof containerSchema>;
