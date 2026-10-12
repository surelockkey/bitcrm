import {
  customFieldEntityType,
  type CustomFieldDefinition,
  type CustomFieldType,
  type CustomFieldValue,
} from "@bitcrm/types";

/** Group heading used for fields left without one. Sorts last. */
export const UNGROUPED = "Other";

/** The job fields of the catalog (Workiz's Job/Lead tab) — a field without an entity is one. */
export function jobCustomFields(defs: readonly CustomFieldDefinition[] | undefined): CustomFieldDefinition[] {
  return (defs ?? []).filter((d) => customFieldEntityType(d) === "job");
}

/** The client fields of the catalog (Workiz's Client tab), answered on the client card. */
export function clientCustomFields(defs: readonly CustomFieldDefinition[] | undefined): CustomFieldDefinition[] {
  return (defs ?? []).filter((d) => customFieldEntityType(d) === "client");
}

/**
 * Job fields that apply to this job type: `[]` scope means all job types. A
 * client field never applies to a job — its answers live on the client.
 */
export function applicableFields(
  defs: CustomFieldDefinition[] | undefined,
  jobTypeId: string,
): CustomFieldDefinition[] {
  return jobCustomFields(defs).filter(
    (d) => d.active && (d.jobTypeIds.length === 0 || d.jobTypeIds.includes(jobTypeId)),
  );
}

/**
 * A drag in Settings → Custom Fields (Workiz drags; B10): `activeId` takes
 * `overId`'s slot in `list` (one group, in its shown order) and the rows
 * between shift by one. The order IS the stored priority, higher first, so
 * the group is renumbered n…1 from the top — 0 stays free for a new field,
 * which lands last — and only the rows whose priority changes come back, to
 * be written.
 */
export function reorderPriorities(
  list: readonly Pick<CustomFieldDefinition, "id" | "priority">[],
  activeId: string,
  overId: string,
): { id: string; priority: number }[] {
  const from = list.findIndex((f) => f.id === activeId);
  const to = list.findIndex((f) => f.id === overId);
  if (from < 0 || to < 0 || from === to) return [];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next
    .map((f, i) => ({ id: f.id, priority: next.length - i, was: f.priority }))
    .filter((f) => f.priority !== f.was)
    .map(({ id, priority }) => ({ id, priority }));
}

/** The keyboard's move up (-1) / move down (+1): the row to trade places with, none past an end. */
export function stepTarget(
  list: readonly Pick<CustomFieldDefinition, "id">[],
  id: string,
  delta: -1 | 1,
): string | undefined {
  const at = list.findIndex((f) => f.id === id);
  if (at < 0) return undefined;
  return list[at + delta]?.id;
}

/**
 * The order of the client groups on Workiz's client page (Custom fields tab,
 * pg_contact_wz_269669_tab_custom-fields): this account's Work Order, then
 * Platinum Info; any other group alphabetically after them; Workiz's
 * ungrouped bucket ("Extra Info", the importer's name for it) and ours last.
 */
export const WORKIZ_CLIENT_GROUP_ORDER = ["Work Order", "Platinum Info"];
const CLIENT_LAST_GROUPS = ["Extra Info", UNGROUPED];

/**
 * The active client fields as the client page lays them out: groups in
 * Workiz's order taking the two columns in turn (Work Order | Platinum Info,
 * then Extra Info under Work Order), fields in priority order within a group.
 */
export function clientFieldColumns(
  defs: readonly CustomFieldDefinition[] | undefined,
): [ReturnType<typeof groupFields>, ReturnType<typeof groupFields>] {
  const rank = (g: string) => {
    const known = WORKIZ_CLIENT_GROUP_ORDER.indexOf(g);
    if (known >= 0) return known;
    const last = CLIENT_LAST_GROUPS.indexOf(g);
    return last >= 0 ? 1000 + last : WORKIZ_CLIENT_GROUP_ORDER.length;
  };
  const groups = groupFields(clientCustomFields(defs).filter((d) => d.active)).sort(
    (a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group),
  );
  const columns: [ReturnType<typeof groupFields>, ReturnType<typeof groupFields>] = [[], []];
  groups.forEach((g, i) => columns[i % 2].push(g));
  return columns;
}

/** No answer: absent, blank text or an empty list. */
function noAnswer(value: CustomFieldValue | null | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * What the client card's Save sends (`PUT /crm/contacts/:id { customFields }`):
 * the answers that differ from the stored ones, `null` for one cleared —
 * crm merges, so an untouched answer is left out. Empty = nothing to save.
 * `draft` starts as a copy of `stored` (keys no form shows included), so a
 * key missing from it was cleared.
 */
export function customFieldAnswersPatch(
  stored: Record<string, CustomFieldValue> | undefined,
  draft: Record<string, CustomFieldValue | undefined>,
): Record<string, CustomFieldValue | null> {
  const before = stored ?? {};
  const patch: Record<string, CustomFieldValue | null> = {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(draft)])) {
    const was = before[id];
    const now = draft[id];
    if (noAnswer(now)) {
      if (!noAnswer(was)) patch[id] = null;
      continue;
    }
    if (JSON.stringify(was) !== JSON.stringify(now)) patch[id] = now as CustomFieldValue;
  }
  return patch;
}

/**
 * Bucket applicable fields by group heading; groups alpha with "Other" last,
 * fields sorted priority desc then name. Mirrors the Settings catalog view.
 */
export function groupFields(
  fields: CustomFieldDefinition[],
): { group: string; fields: CustomFieldDefinition[] }[] {
  const buckets = new Map<string, CustomFieldDefinition[]>();
  for (const f of fields) {
    const key = f.group.trim() || UNGROUPED;
    const bucket = buckets.get(key) ?? [];
    bucket.push(f);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b);
    })
    .map(([group, list]) => ({
      group,
      fields: list.sort((x, y) => y.priority - x.priority || x.name.localeCompare(y.name)),
    }));
}

/**
 * Card order of the custom-field groups on the Workiz job forms: Extra Info |
 * Other Contact, Dispatchers | Tech, Platinum on both New Job
 * (new_01_empty_scroll1) and the job page (job_b_01_details_scroll1).
 */
export const WORKIZ_GROUP_ORDER = [
  "Extra Info",
  "Other Contact",
  "Dispatchers",
  "Tech",
  "Platinum",
  "Company",
  "Need To Order",
];

/**
 * groupFields, reordered as on the Workiz form — its known groups first, in
 * its order; anything else keeps groupFields' alphabetical tail.
 */
export function workizOrderedGroups(
  fields: CustomFieldDefinition[],
): { group: string; fields: CustomFieldDefinition[] }[] {
  const rank = (g: string) => {
    const i = WORKIZ_GROUP_ORDER.indexOf(g);
    return i === -1 ? WORKIZ_GROUP_ORDER.length : i;
  };
  return [...groupFields(fields)].sort((a, b) => rank(a.group) - rank(b.group));
}

/**
 * The column each known group sits in on both Workiz job forms — the New Job
 * cards (new_01_empty_scroll1: Extra Info x264 | Other Contact x939,
 * Dispatchers x264 | Tech x939, Platinum x264) and the job page's Details
 * tab (job_b_01_details_scroll1): Extra Info, Dispatchers and Platinum down
 * the left, Other Contact and Tech down the right. Pinned by name: a catalog
 * without one of them (dev has no "Other Contact") must not slide the rest
 * over, which is how Dispatchers landed right and Tech left (app_audit #7).
 */
export const WORKIZ_GROUP_COLUMN: Readonly<Record<string, 0 | 1>> = {
  "Extra Info": 0,
  "Other Contact": 1,
  Dispatchers: 0,
  Tech: 1,
  Platinum: 0,
};

/**
 * The groups split into Workiz's two columns, `[left, right]`, in their
 * given order: a known group at its side; one Workiz has no place for fills
 * whichever column holds fewer groups at that point (the left on a tie).
 */
export function workizGroupColumns<T extends { group: string }>(groups: readonly T[]): [T[], T[]] {
  const columns: [T[], T[]] = [[], []];
  for (const g of groups) {
    const known = WORKIZ_GROUP_COLUMN[g.group];
    const side = known ?? (columns[1].length < columns[0].length ? 1 : 0);
    columns[side].push(g);
  }
  return columns;
}

/**
 * Whether a stored answer counts as "unfilled". Blank/whitespace strings, empty
 * arrays and an unchecked checkbox (`false`) are empty; `0` and `true` are real
 * answers. Used to enforce `required` fields before a job can be created.
 */
export function isCustomFieldAnswerEmpty(value: CustomFieldValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "boolean") return value === false;
  return false;
}

/**
 * The required, applicable custom fields still missing an answer — used to block
 * a create submit until they're filled (mirrors other required deal fields).
 */
export function missingRequiredCustomFields(
  defs: CustomFieldDefinition[] | undefined,
  jobTypeId: string,
  value: Record<string, CustomFieldValue>,
): CustomFieldDefinition[] {
  return applicableFields(defs, jobTypeId).filter(
    (f) => f.required && isCustomFieldAnswerEmpty(value[f.id]),
  );
}

/** The Workiz kit control a custom field is drawn with. */
export type CustomFieldControl =
  | "text"
  | "number"
  | "textarea"
  | "select"
  | "multiselect"
  | "checkbox"
  | "date"
  | "upload";

const CONTROL_BY_TYPE: Record<CustomFieldType, CustomFieldControl> = {
  text: "text",
  number: "number",
  large_text: "textarea",
  dropdown: "select",
  multi_select: "multiselect",
  checkbox: "checkbox",
  date: "date",
  file: "upload",
};

/**
 * Which control draws a field of this type on the Workiz forms: text and
 * number are the floating-label box, long text the textarea with its name as
 * placeholder ("Manager Note"), dropdowns the select, files the "+" tile with
 * "You can choose up to 5 files". A type this build does not know yet is a
 * text box, so the answer can still be read and typed.
 */
export function customFieldControl(type: CustomFieldType): CustomFieldControl {
  return CONTROL_BY_TYPE[type] ?? "text";
}
