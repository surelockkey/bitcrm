/**
 * Built-in New Job fields an admin can mark required (Settings → Job Fields).
 * One registry for both layers: the web renders toggles and asterisks from it,
 * the deal service validates creates against it. Custom fields carry their own
 * `required` flag on the definition and don't appear here.
 */
export const JOB_REQUIRABLE_FIELDS = [
  { id: 'phone', label: 'Client phone' },
  { id: 'email', label: 'Client email' },
  { id: 'address', label: 'Service address' },
  { id: 'serviceArea', label: 'Service area' },
  { id: 'jobType', label: 'Job type' },
  { id: 'source', label: 'Job source' },
  { id: 'scheduled', label: 'Scheduled date' },
  { id: 'description', label: 'Job description' },
  { id: 'poNumber', label: 'PO number' },
  { id: 'tags', label: 'Tags' },
] as const;

export type JobRequirableFieldId = (typeof JOB_REQUIRABLE_FIELDS)[number]['id'];

export interface JobFieldSettings {
  /** Field id → must be filled to create a job. Missing ids fall to defaults. */
  requiredFields: Record<string, boolean>;
}

/** What's effectively required today, before an admin ever touches the page. */
export const DEFAULT_JOB_FIELD_SETTINGS: JobFieldSettings = {
  requiredFields: { address: true, jobType: true },
};
