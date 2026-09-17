import { z } from "zod";
import { DOCUMENT_TEMPLATE_KINDS } from "@bitcrm/types";

/* -------------------------------------------------------------- templates */

export const PRESET_IDS = ["classic", "modern", "minimal"] as const;

export const newTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Keep it under 120 characters"),
  kind: z.enum(DOCUMENT_TEMPLATE_KINDS),
  presetId: z.enum(PRESET_IDS).optional(),
  fromTemplateId: z.string().min(1).optional(),
});
export type NewTemplateValues = z.infer<typeof newTemplateSchema>;

export const templateNameSchema = z.string().trim().min(1, "Name is required").max(120, "Keep it under 120 characters");

/* ------------------------------------------------------------------ assets */

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "Use a PNG, JPEG or WebP image.";
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}
