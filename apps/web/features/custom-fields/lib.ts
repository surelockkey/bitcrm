import type { CustomFieldDefinition, CustomFieldValue } from "@bitcrm/types";

/** Group heading used for fields left without one. Sorts last. */
export const UNGROUPED = "Other";

/** Definitions that apply to this job type: `[]` scope means all job types. */
export function applicableFields(
  defs: CustomFieldDefinition[] | undefined,
  jobTypeId: string,
): CustomFieldDefinition[] {
  return (defs ?? []).filter(
    (d) => d.active && (d.jobTypeIds.length === 0 || d.jobTypeIds.includes(jobTypeId)),
  );
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

/** Card order of the custom-field groups on the Workiz job forms. */
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
