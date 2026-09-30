import type { CustomFieldDefinition, CustomFieldValue } from "@bitcrm/types";

/**
 * Static hideable columns of the Jobs table — every displayable deal field.
 * Order here is column order. The job number is intentionally not listed: it
 * carries the row's open-in-new-tab link, so it always renders first.
 *
 * `width` (px) is what the table lays each column out at. The Jobs table is
 * `table-fixed` on purpose: client and technician names arrive in a later
 * frame than the jobs themselves, and an auto-layout table re-measures every
 * column when they land — the whole grid visibly jumps. Fixed widths mean the
 * first painted frame is the final geometry, and a long value is clipped
 * rather than allowed to shove its neighbours.
 *
 * `sent` / `seen` are the Workiz dispatch stamps (`last_sent` / `seen`): both
 * off by default, like every other opt-in column, so an existing saved
 * preference is unaffected.
 */
export const JOB_FIELDS = [
  { id: "client", label: "Client", width: 200 },
  { id: "phone", label: "Phone", width: 150 },
  { id: "email", label: "Email", width: 210 },
  { id: "clientType", label: "Client type", width: 120 },
  { id: "tech", label: "Tech", width: 170 },
  { id: "dispatcher", label: "Dispatcher", width: 150 },
  { id: "tags", label: "Tags", width: 180 },
  { id: "status", label: "Status", width: 140 },
  { id: "priority", label: "Priority", width: 110 },
  { id: "city", label: "City", width: 130 },
  { id: "state", label: "State", width: 80 },
  { id: "zip", label: "Zip code", width: 100 },
  { id: "address", label: "Address", width: 260 },
  { id: "serviceArea", label: "Service area", width: 160 },
  { id: "scheduled", label: "Scheduled", width: 180 },
  { id: "sent", label: "Sent", width: 150 },
  { id: "seen", label: "Seen", width: 150 },
  { id: "jobType", label: "Job type", width: 160 },
  { id: "source", label: "Source", width: 150 },
  { id: "externalCompany", label: "External company", width: 180 },
  { id: "company", label: "Company", width: 170 },
  { id: "poNumber", label: "PO number", width: 130 },
  { id: "total", label: "Total", width: 110 },
  { id: "paymentStatus", label: "Payment status", width: 150 },
  { id: "notes", label: "Notes", width: 240 },
  { id: "createdBy", label: "Created by", width: 150 },
  { id: "createdAt", label: "Created", width: 160 },
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

/** A custom field has no declared width — one size for all of them. */
export const CUSTOM_FIELD_WIDTH = 160;

/** The job-number column, which is always first and never hideable. */
export const JOB_NUMBER_WIDTH = 92;

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
): { id: string; label: string; width: number }[] {
  const cf = (customFields ?? [])
    .filter((f) => f.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .map((f) => ({ id: customFieldColumnId(f.id), label: f.name, width: CUSTOM_FIELD_WIDTH }));
  return [...JOB_FIELDS.map((f) => ({ id: f.id, label: f.label, width: f.width })), ...cf];
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
