import type { CustomFieldDefinition, CustomFieldValue } from "@bitcrm/types";

/**
 * Static hideable columns of the Jobs table — every displayable deal field.
 * Order here is column order. The job number is intentionally not listed: it
 * carries the row's open-in-new-tab link, so it always renders first.
 */
export const JOB_FIELDS = [
  { id: "client", label: "Client" },
  { id: "phone", label: "Phone" },
  { id: "email", label: "Email" },
  { id: "clientType", label: "Client type" },
  { id: "tech", label: "Tech" },
  { id: "dispatcher", label: "Dispatcher" },
  { id: "tags", label: "Tags" },
  { id: "status", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "city", label: "City" },
  { id: "state", label: "State" },
  { id: "zip", label: "Zip code" },
  { id: "address", label: "Address" },
  { id: "serviceArea", label: "Service area" },
  { id: "scheduled", label: "Scheduled" },
  { id: "jobType", label: "Job type" },
  { id: "source", label: "Source" },
  { id: "externalCompany", label: "External company" },
  { id: "poNumber", label: "PO number" },
  { id: "total", label: "Total" },
  { id: "paymentStatus", label: "Payment status" },
  { id: "notes", label: "Notes" },
  { id: "createdBy", label: "Created by" },
  { id: "createdAt", label: "Created" },
] as const;

export type JobFieldId = (typeof JOB_FIELDS)[number]["id"];

/** Column ids a user can toggle: a static field id or `cf:<customFieldId>`. */
export type VisibleFields = Record<string, boolean>;

/** The classic columns stay on out of the box; everything else is opt-in. */
const DEFAULT_ON: readonly string[] = ["client", "tech", "tags", "city", "state", "scheduled", "jobType"];

export const DEFAULT_VISIBLE: VisibleFields = Object.fromEntries(
  JOB_FIELDS.map((f) => [f.id, DEFAULT_ON.includes(f.id)]),
);

export const CUSTOM_FIELD_PREFIX = "cf:";

export const customFieldColumnId = (customFieldId: string): string =>
  `${CUSTOM_FIELD_PREFIX}${customFieldId}`;

/** `cf:<id>` → `<id>`, or null for a static field id. */
export function customFieldIdFromColumn(columnId: string): string | null {
  return columnId.startsWith(CUSTOM_FIELD_PREFIX)
    ? columnId.slice(CUSTOM_FIELD_PREFIX.length)
    : null;
}

/**
 * Everything the fields panel can offer, in column order: the static registry
 * followed by the active custom fields (priority desc, then name).
 */
export function jobFieldOptions(
  customFields?: CustomFieldDefinition[],
): { id: string; label: string }[] {
  const cf = (customFields ?? [])
    .filter((f) => f.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .map((f) => ({ id: customFieldColumnId(f.id), label: f.name }));
  return [...JOB_FIELDS.map((f) => ({ id: f.id, label: f.label })), ...cf];
}

/** Render a custom-field answer for a table cell. */
export function formatCustomFieldValue(value: CustomFieldValue | undefined): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

/**
 * Coerce whatever came out of localStorage into a valid visibility map:
 * static ids and `cf:` keys keep their booleans, unknown keys are dropped,
 * missing or non-boolean values fall back to defaults. The retired "location"
 * column migrates into city + state so an old preference isn't lost.
 */
export function sanitizeVisibleFields(raw: unknown): VisibleFields {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: VisibleFields = Object.fromEntries(
    JOB_FIELDS.map((f) => {
      const v = source[f.id];
      return [f.id, typeof v === "boolean" ? v : DEFAULT_VISIBLE[f.id]];
    }),
  );
  if (typeof source.location === "boolean") {
    if (typeof source.city !== "boolean") out.city = source.location;
    if (typeof source.state !== "boolean") out.state = source.location;
  }
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith(CUSTOM_FIELD_PREFIX) && typeof v === "boolean") out[k] = v;
  }
  return out;
}
