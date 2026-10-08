import type { CustomFieldDefinition, CustomFieldValue } from "@bitcrm/types";

/**
 * The glyph Workiz draws at the right of a field in its Visible fields panel
 * (list_02_fields_menu: `wfi-job`, `wfi-clients-users`, `wfi-tags`,
 * `wfi-Location`, `wfi-default`, `wfi-finance`, `wfi-Phone`, `wfi-email`,
 * `wfi-map`, `wfi-Ad-tracking`, and `wfi-nearby-devices` for custom fields).
 */
export type FieldIcon =
  | "job"
  | "users"
  | "tag"
  | "location"
  | "calendar"
  | "money"
  | "phone"
  | "email"
  | "map"
  | "source"
  | "custom";

/**
 * Static hideable columns of the Jobs table — every displayable deal field.
 * Registry order is the column order until the reader drags them into their
 * own (`order` in the fields store). The job number is intentionally not
 * listed: it is Workiz's Job ID column, always first and never hidden.
 *
 * The order is Workiz's: the eight classic columns as their list draws them,
 * then the fields its panel offers in the order it offers them (Zip code,
 * Total Price, Company, Source, Address, Created by, End, Phone, Email,
 * Service area, External Company, Time in Status), then the ones Workiz has
 * no column for.
 *
 * `width` (px) is what the table lays each column out at — Workiz's own for
 * the columns it has (Client 160, Tech 200, Scheduled 220, Job Type 200…).
 * The Jobs table is `table-fixed` on purpose: client and technician names
 * arrive in a later frame than the jobs themselves, and an auto-layout table
 * re-measures every column when they land — the whole grid visibly jumps.
 * Fixed widths mean the first painted frame is the final geometry, and a long
 * value is clipped rather than allowed to shove its neighbours.
 *
 * `sent` / `seen` are the Workiz dispatch stamps (`last_sent` / `seen`): both
 * off by default, like every other opt-in column, so an existing saved
 * preference is unaffected.
 */
export const JOB_FIELDS = [
  { id: "client", label: "Client", width: 160, icon: "users" },
  { id: "tech", label: "Tech", width: 200, icon: "users" },
  { id: "tags", label: "Tags", width: 160, icon: "tag" },
  { id: "city", label: "City", width: 160, icon: "location" },
  { id: "state", label: "State", width: 160, icon: "location" },
  { id: "scheduled", label: "Scheduled", width: 220, icon: "calendar" },
  { id: "jobType", label: "Job Type", width: 200, icon: "job" },
  { id: "zip", label: "Zip code", width: 100, icon: "location" },
  { id: "total", label: "Total Price", width: 120, icon: "money" },
  { id: "company", label: "Company", width: 170, icon: "custom" },
  { id: "source", label: "Source", width: 150, icon: "source" },
  { id: "address", label: "Address", width: 260, icon: "location" },
  { id: "createdBy", label: "Created by", width: 150, icon: "users" },
  { id: "end", label: "End", width: 220, icon: "calendar" },
  { id: "phone", label: "Phone", width: 150, icon: "phone" },
  { id: "email", label: "Email", width: 210, icon: "email" },
  { id: "serviceArea", label: "Service area", width: 160, icon: "map" },
  { id: "externalCompany", label: "External Company", width: 180, icon: "custom" },
  { id: "timeInStatus", label: "Time in Status", width: 150, icon: "calendar" },
  { id: "jobName", label: "Job name", width: 200, icon: "job" },
  { id: "clientType", label: "Client type", width: 120, icon: "users" },
  { id: "dispatcher", label: "Dispatcher", width: 150, icon: "users" },
  { id: "status", label: "Status", width: 140, icon: "job" },
  { id: "priority", label: "Priority", width: 110, icon: "job" },
  { id: "sent", label: "Sent", width: 150, icon: "calendar" },
  { id: "seen", label: "Seen", width: 150, icon: "calendar" },
  { id: "poNumber", label: "PO number", width: 130, icon: "job" },
  { id: "paymentStatus", label: "Payment status", width: 150, icon: "money" },
  { id: "notes", label: "Notes", width: 240, icon: "job" },
  { id: "createdAt", label: "Created", width: 160, icon: "calendar" },
] as const satisfies readonly { id: string; label: string; width: number; icon: FieldIcon }[];

export type JobFieldId = (typeof JOB_FIELDS)[number]["id"];

/** One column the panel can offer: a static field or an active custom field. */
export interface JobFieldOption {
  id: string;
  label: string;
  width: number;
  icon: FieldIcon;
}

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

/** Workiz's Job ID column: always first, never hideable, 140px. */
export const JOB_NUMBER_WIDTH = 140;

export const customFieldColumnId = (customFieldId: string): string =>
  `${CUSTOM_FIELD_PREFIX}${customFieldId}`;

/** `cf:<id>` → `<id>`, or null for a static field id. */
export function customFieldIdFromColumn(columnId: string): string | null {
  return columnId.startsWith(CUSTOM_FIELD_PREFIX)
    ? columnId.slice(CUSTOM_FIELD_PREFIX.length)
    : null;
}

/**
 * Everything the fields panel can offer, in registry order: the static
 * fields followed by the active custom fields (priority desc, then name).
 */
export function jobFieldOptions(customFields?: CustomFieldDefinition[]): JobFieldOption[] {
  const cf = (customFields ?? [])
    .filter((f) => f.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .map((f) => ({
      id: customFieldColumnId(f.id),
      label: f.name,
      width: CUSTOM_FIELD_WIDTH,
      icon: "custom" as const,
    }));
  return [...JOB_FIELDS.map((f) => ({ id: f.id, label: f.label, width: f.width, icon: f.icon })), ...cf];
}

/**
 * The table's columns, in the order the reader saved: the ids `order` names
 * (when visible and still offered), then any other visible field in registry
 * order — a field switched on before orders were kept, or a new one.
 */
export function orderedColumns<T extends { id: string }>(
  options: T[],
  visible: VisibleFields,
  order: readonly string[],
): T[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  const placed = order.filter((id, i) => visible[id] && byId.has(id) && order.indexOf(id) === i);
  const rest = options.filter((o) => visible[o.id] && !placed.includes(o.id)).map((o) => o.id);
  return [...placed, ...rest].map((id) => byId.get(id)!);
}

/* ---------------------------------------------- the Visible fields panel */

/**
 * The panel edits a draft — the ids under USED FIELDS, in column order —
 * and nothing reaches the table until "Save fields". This is where it starts.
 */
export function draftFromSaved(
  options: { id: string }[],
  visible: VisibleFields,
  order: readonly string[],
): string[] {
  return orderedColumns(options, visible, order).map((o) => o.id);
}

/** Ticking a field adds it at the end of USED FIELDS; unticking takes it out. */
export function toggleDraft(used: readonly string[], id: string): string[] {
  return used.includes(id) ? used.filter((u) => u !== id) : [...used, id];
}

/** A drag: `id` takes `overId`'s slot and the fields between shift by one. */
export function moveDraft(used: readonly string[], id: string, overId: string): string[] {
  const from = used.indexOf(id);
  const to = used.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...used];
  const next = [...used];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * The two lists the panel draws: USED FIELDS in the draft's order and
 * UNSELECTED FIELDS in registry order, both narrowed by the "Search fields"
 * box (case-insensitive substring of the label).
 */
export function panelLists<T extends { id: string; label: string }>(
  options: T[],
  used: readonly string[],
  query: string,
): { used: T[]; unselected: T[] } {
  const q = query.trim().toLowerCase();
  const hit = (o: T) => !q || o.label.toLowerCase().includes(q);
  const byId = new Map(options.map((o) => [o.id, o]));
  return {
    used: used.map((id) => byId.get(id)).filter((o): o is T => !!o && hit(o)),
    unselected: options.filter((o) => !used.includes(o.id) && hit(o)),
  };
}

/** "Save fields": every offered field gets an explicit on/off, and USED FIELDS is the order. */
export function savedFromDraft(
  options: { id: string }[],
  used: readonly string[],
): { visible: VisibleFields; order: string[] } {
  return {
    visible: Object.fromEntries(options.map((o) => [o.id, used.includes(o.id)])),
    order: used.filter((id) => options.some((o) => o.id === id)),
  };
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

/** A stored column order: distinct non-empty strings, nothing else. */
export function sanitizeFieldOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (typeof v === "string" && v && !out.includes(v)) out.push(v);
  return out;
}
