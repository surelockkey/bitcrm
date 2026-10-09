/**
 * Built-in New Job fields an admin can mark required (Settings → Field
 * Validation, Workiz's `manage_fields`). One registry for both layers: the web
 * renders the rows and the "Required field" marks from it, the deal service
 * validates `POST /deals` against it (Workiz: "Field validation applies for
 * job creation only"). Custom fields carry their own `required` flag on the
 * definition and don't appear here.
 *
 * The first rows are Workiz's, in its order and words
 * (pg_settings_catalogs_wz_managefields, 2026-10-09): First Name, Last Name,
 * Client Company Name, Primary Phone, Secondary Phone, Email Address,
 * "External Company or Ad Group" (either one satisfies it), Client Address,
 * Job Address. Workiz's "Payment Approval #", "Parts" and "Total" are rows
 * for fields its own New Job form no longer has, so they are left out. The
 * rest are ours.
 *
 * `owner` says where the answer lives: on the job's own create body, or on
 * the client (the contact record, or the client typed on the New Job form).
 */
export const JOB_REQUIRABLE_FIELDS = [
  { id: 'firstName', label: 'First Name', owner: 'client' },
  { id: 'lastName', label: 'Last Name', owner: 'client' },
  { id: 'companyName', label: 'Client Company Name', owner: 'client' },
  { id: 'phone', label: 'Primary Phone', owner: 'client' },
  { id: 'secondaryPhone', label: 'Secondary Phone', owner: 'client' },
  { id: 'email', label: 'Email Address', owner: 'client' },
  { id: 'externalCompanyOrSource', label: 'External Company or Ad Group', owner: 'job' },
  { id: 'clientAddress', label: 'Client Address', owner: 'client' },
  { id: 'address', label: 'Job Address', owner: 'job' },
  { id: 'serviceArea', label: 'Service area', owner: 'job' },
  { id: 'jobType', label: 'Job type', owner: 'job' },
  { id: 'source', label: 'Job source', owner: 'job' },
  { id: 'externalCompany', label: 'External company', owner: 'job' },
  { id: 'scheduled', label: 'Scheduled date', owner: 'job' },
  // Workiz calls this the job note, and so do the people migrating from it.
  { id: 'description', label: 'Job note', owner: 'job' },
  { id: 'poNumber', label: 'PO number', owner: 'job' },
  { id: 'tags', label: 'Tags', owner: 'job' },
] as const;

export type JobRequirableFieldId = (typeof JOB_REQUIRABLE_FIELDS)[number]['id'];

/** The ids whose answer is on the client, not on the job's create body. */
export const CLIENT_OWNED_JOB_FIELD_IDS: readonly JobRequirableFieldId[] = JOB_REQUIRABLE_FIELDS.filter(
  (f) => f.owner === 'client',
).map((f) => f.id);

export interface JobFieldSettings {
  /** Field id → must be filled to create a job. Missing ids fall to defaults. */
  requiredFields: Record<string, boolean>;
}

/** What's effectively required today, before an admin ever touches the page. */
export const DEFAULT_JOB_FIELD_SETTINGS: JobFieldSettings = {
  requiredFields: { address: true, jobType: true },
};

/**
 * Every registered id, the defaults on and the rest off — what "Restore
 * Default Settings" (Workiz's link under the rows) writes back.
 */
export function defaultJobFieldSettings(): JobFieldSettings {
  const requiredFields: Record<string, boolean> = {};
  for (const f of JOB_REQUIRABLE_FIELDS) {
    requiredFields[f.id] = DEFAULT_JOB_FIELD_SETTINGS.requiredFields[f.id] ?? false;
  }
  return { requiredFields };
}
