import type { CustomFieldDefinition, CustomFieldValue, Deal, JobTag } from "@bitcrm/types";
import type { DealJobValues } from "./schemas";

/**
 * Workiz's job Actions → "Duplicate Job" (job_b_02_actions_open): New Job,
 * filled in from the job, for the dispatcher to look over and Create — the
 * copy is an ordinary new job ("Created Job" on its timeline, the only line
 * Workiz writes for one; its log has no "duplicated" sentence).
 *
 * What comes along is the job's details: the same client (the job keeps its
 * client — a copy never makes a new one), the service address, job type, job
 * name, source, service area, company, referring company, priority, the
 * description, the tags still in use and the custom-field answers. What never
 * does is the new visit's own: the schedule (New Job's default time), the
 * team, items, payments, invoice, estimates, attachments, and the work order
 * and PO that authorized this one. File answers point at this job's
 * attachments, so they stay behind too.
 */
export function duplicateJobHref(dealId: string): string {
  return `/deals/new?duplicate=${encodeURIComponent(dealId)}`;
}

/** The New Job fields a duplicate fills in. */
export type DuplicateValues = Pick<
  DealJobValues,
  "jobTypeId" | "jobName" | "serviceAreaId" | "address" | "priority" | "sourceId" | "externalCompanyId" | "notes"
>;

export interface DuplicatePrefill {
  /** The client the copy is for — the job's own. */
  contactId: string;
  values: DuplicateValues;
  tagIds: string[];
  customFields: Record<string, CustomFieldValue>;
  /** The company (business profile) the job is done under. */
  businessProfileId?: string;
}

export function duplicatePrefill(
  deal: Deal,
  catalogs: {
    customFieldDefs?: ReadonlyArray<Pick<CustomFieldDefinition, "id" | "type" | "active">>;
    jobTags?: ReadonlyArray<Pick<JobTag, "id" | "active">>;
  },
): DuplicatePrefill {
  const a = deal.address;
  const activeTags = new Set((catalogs.jobTags ?? []).filter((t) => t.active).map((t) => t.id));
  const copyable = new Set(
    (catalogs.customFieldDefs ?? []).filter((f) => f.active && f.type !== "file").map((f) => f.id),
  );
  return {
    contactId: deal.contactId,
    values: {
      jobTypeId: deal.jobTypeId ?? "",
      jobName: deal.jobName ?? "",
      serviceAreaId: deal.serviceAreaId ?? "",
      address: {
        street: a?.street ?? "",
        unit: a?.unit ?? "",
        city: a?.city ?? "",
        state: a?.state ?? "",
        zip: a?.zip ?? "",
        ...(a?.country ? { country: a.country } : {}),
        ...(a?.lat !== undefined ? { lat: a.lat } : {}),
        ...(a?.lng !== undefined ? { lng: a.lng } : {}),
      },
      priority: deal.priority,
      sourceId: deal.sourceId ?? "",
      externalCompanyId: deal.externalCompanyId ?? "",
      notes: deal.notes ?? "",
    },
    tagIds: (deal.tagIds ?? []).filter((id) => activeTags.has(id)),
    customFields: Object.fromEntries(Object.entries(deal.customFields ?? {}).filter(([id]) => copyable.has(id))),
    ...(deal.businessProfileId ? { businessProfileId: deal.businessProfileId } : {}),
  };
}
