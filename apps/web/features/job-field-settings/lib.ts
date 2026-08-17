import { JOB_REQUIRABLE_FIELDS, type JobFieldSettings } from "@bitcrm/types";

interface JobFormInput {
  values: {
    address?: { street?: string };
    serviceArea?: string;
    jobTypeId?: string;
    sourceId?: string;
    scheduledDate?: string;
    notes?: string;
    poNumber?: string;
    tagIds?: string[];
  };
  /** From the resolved contact or the new-client draft. */
  clientPhone?: string;
  clientEmail?: string;
}

const FILLED: Record<string, (i: JobFormInput) => boolean> = {
  phone: (i) => Boolean(i.clientPhone?.trim()),
  email: (i) => Boolean(i.clientEmail?.trim()),
  address: (i) => Boolean(i.values.address?.street?.trim()),
  serviceArea: (i) => Boolean(i.values.serviceArea?.trim()),
  jobType: (i) => Boolean(i.values.jobTypeId),
  source: (i) => Boolean(i.values.sourceId),
  scheduled: (i) => Boolean(i.values.scheduledDate),
  description: (i) => Boolean(i.values.notes?.trim()),
  poNumber: (i) => Boolean(i.values.poNumber?.trim()),
  tags: (i) => Boolean(i.values.tagIds?.length),
};

/**
 * Labels of the admin-required built-in fields this form submission leaves
 * empty, in registry order. Quiet while the settings are still loading —
 * the server enforces its share anyway.
 */
export function missingRequiredJobFields(
  settings: JobFieldSettings | undefined,
  input: JobFormInput,
): string[] {
  if (!settings) return [];
  return JOB_REQUIRABLE_FIELDS.filter(
    (f) => settings.requiredFields[f.id] && !FILLED[f.id]?.(input),
  ).map((f) => f.label);
}
