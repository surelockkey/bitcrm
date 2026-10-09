import { JOB_REQUIRABLE_FIELDS, defaultJobFieldSettings, type JobFieldSettings } from "@bitcrm/types";

/** The client as the New Job form knows them: typed into the card, or the picked record. */
export interface JobFormClient {
  firstName?: string;
  lastName?: string;
  /** The "Company name" typed, or the picked client's company title. */
  company?: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  /** The picked client has an address of their own, or a service location was typed (a new client gets it). */
  hasAddress?: boolean;
}

interface JobFormInput {
  values: {
    address?: { street?: string };
    serviceArea?: string;
    jobTypeId?: string;
    sourceId?: string;
    externalCompanyId?: string;
    scheduledDate?: string;
    notes?: string;
    poNumber?: string;
    tagIds?: string[];
  };
  client?: JobFormClient;
}

const filled = (s: string | undefined) => Boolean(s?.trim());

const FILLED: Record<string, (i: JobFormInput) => boolean> = {
  firstName: (i) => filled(i.client?.firstName),
  lastName: (i) => filled(i.client?.lastName),
  companyName: (i) => filled(i.client?.company),
  phone: (i) => filled(i.client?.phone),
  secondaryPhone: (i) => filled(i.client?.secondaryPhone),
  email: (i) => filled(i.client?.email),
  // Workiz's "External Company or Ad Group Required?": either one will do.
  externalCompanyOrSource: (i) => Boolean(i.values.externalCompanyId || i.values.sourceId),
  clientAddress: (i) => Boolean(i.client?.hasAddress) || filled(i.values.address?.street),
  address: (i) => filled(i.values.address?.street),
  serviceArea: (i) => filled(i.values.serviceArea),
  jobType: (i) => Boolean(i.values.jobTypeId),
  source: (i) => Boolean(i.values.sourceId),
  externalCompany: (i) => Boolean(i.values.externalCompanyId),
  scheduled: (i) => Boolean(i.values.scheduledDate),
  description: (i) => filled(i.values.notes),
  poNumber: (i) => filled(i.values.poNumber),
  tags: (i) => Boolean(i.values.tagIds?.length),
};

/**
 * The admin-required built-in fields this form submission leaves empty, in
 * the Field Validation page's order (Workiz's rows first) — id for marking
 * the field itself, label for the summary. Quiet while the settings are
 * still loading — the server enforces its share anyway.
 */
export function missingRequiredJobFields(
  settings: JobFieldSettings | undefined,
  input: JobFormInput,
): { id: string; label: string }[] {
  if (!settings) return [];
  return JOB_REQUIRABLE_FIELDS.filter(
    (f) => settings.requiredFields[f.id] && !FILLED[f.id]?.(input),
  ).map((f) => ({ id: f.id, label: f.label }));
}

/** Workiz's "Restore Default Settings": every row back to its default (ours: the job address and type). */
export function restoredJobFieldSettings(): JobFieldSettings {
  return defaultJobFieldSettings();
}
