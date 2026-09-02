import { z } from "zod";
import { ServiceAreaType } from "@bitcrm/types";
import { DEFAULT_TZ } from "@/lib/timezone";

export const zipEntrySchema = z.object({
  zip: z.string().trim().min(3, "ZIP required"),
  // Empty string in the input → undefined (use the service default). Preprocess
  // BEFORE coercion, else `Number("")` becomes 0 and the default is lost.
  radiusMiles: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().min(0).max(500).optional(),
  ),
});

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * One form for both area types. `type` drives which geometry field is required;
 * `superRefine` enforces "zips when zips, ≥3 vertices when polygon" so the
 * submit button can stay disabled with a clear message.
 */
export const serviceAreaFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    priority: z.coerce.number().int().min(0).default(0),
    active: z.boolean().default(true),
    timezone: z.string().default(DEFAULT_TZ),
    type: z.nativeEnum(ServiceAreaType),
    zips: z.array(zipEntrySchema).default([]),
    vertices: z.array(geoPointSchema).default([]),
    /**
     * The workspace number clients in this market are dialled FROM on masked
     * calls. Empty string clears it — the API treats "" and null the same.
     */
    callerId: z.string().default(""),
  })
  .superRefine((val, ctx) => {
    if (val.type === ServiceAreaType.ZIPS && val.zips.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one ZIP code",
        path: ["zips"],
      });
    }
    if (val.type === ServiceAreaType.POLYGON && val.vertices.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Drop at least 3 points on the map",
        path: ["vertices"],
      });
    }
  });

export type ServiceAreaFormValues = z.input<typeof serviceAreaFormSchema>;
export type ServiceAreaFormOutput = z.output<typeof serviceAreaFormSchema>;

/** Turn validated form output into the API create/update body. */
export function toServiceAreaBody(v: ServiceAreaFormOutput) {
  // A whitelist: a field missing here never leaves the browser, and the
  // symptom is a setting that silently refuses to save.
  const base = {
    name: v.name,
    priority: v.priority,
    active: v.active,
    timezone: v.timezone,
    type: v.type,
    callerId: v.callerId,
  };
  return v.type === ServiceAreaType.ZIPS
    ? { ...base, zips: v.zips }
    : { ...base, vertices: v.vertices };
}
