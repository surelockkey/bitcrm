import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";
import type { FakeRoute } from "@/test/page-load";

/**
 * A job and the fake server behind the technician's job page tests — the
 * job page's own set (deal-detail-page.loading.test.tsx), with the job on
 * the signed-in technician "t1".
 */

export const techJobContact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

export const techJob: Deal = {
  id: "d1",
  dealNumber: "1042",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "North",
  serviceAreaId: "sa-1",
  address: { street: "1 Main", city: "Marietta", state: "GA", zip: "30060", lat: 33.95, lng: -84.55 },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u-disp",
  priority: DealPriority.NORMAL,
  assignedTechIds: ["t1"],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
};

const area = { id: "sa-1", name: "North Metro", active: true, priority: 1, timezone: "America/New_York" };

/** The fake server: path (no query string) → what it answers. `job()` is read on every ask. */
export function techJobRoutes(job: () => Deal = () => techJob): FakeRoute[] {
  return [
    { match: /\/deals\/d1$/, reply: () => job() },
    { match: /\/deals\/d1\/seen$/, method: "POST", reply: () => ({ first: false }) },
    { match: /\/deals\/d1\/attachments$/, reply: () => [] },
    { match: /\/deals\/d1\/assignments$/, reply: () => [] },
    { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true }] },
    { match: /\/deals\/job-sources$/, reply: () => [] },
    { match: /\/deals\/external-companies$/, reply: () => [] },
    { match: /\/billing\/business-profiles$/, reply: () => [] },
    { match: /\/deals\/custom-fields$/, reply: () => [] },
    { match: /\/deals\/job-statuses$/, reply: () => [] },
    { match: /\/deals\/job-tags$/, reply: () => [] },
    { match: /\/crm\/contacts\/c1$/, reply: () => techJobContact },
    { match: /\/messaging\/settings$/, reply: () => ({}) },
    { match: /\/deals\/service-areas$/, reply: () => [area] },
    { match: /\/deals\/service-areas\/resolve$/, reply: () => area },
    { match: /\/deals\/service-areas\/nearest$/, reply: () => null },
    { match: /\/deals\/qualified-techs$/, reply: () => [] },
    { match: /\/telephony\/config$/, reply: () => ({ technicianLine: "+14045550140" }) },
    { match: /\/telephony\/exts\/by-deal\/d1$/, reply: () => ({ code: "8707" }) },
    { match: /\/billing\/invoices\/by-deal\/d1$/, reply: () => null },
    { match: /\/billing\/deals\/d1\/payments$/, reply: () => ({ balanceDue: 0, payments: [] }) },
    { match: /\/deals\/d1\/timeline$/, raw: true, reply: () => ({ success: true, data: [], pagination: { count: 0 } }) },
    { match: /\/billing\/estimates\/by-deal\/d1$/, reply: () => [] },
    { match: /\/messaging\/messages\/by-job\/d1$/, raw: true, reply: () => ({ success: true, data: [], pagination: { count: 0 } }) },
    // A technician has no users.view: the team's names come by id.
    {
      match: /\/users\/by-ids$/,
      method: "POST",
      reply: () => [{ id: "t1", firstName: "Tess", lastName: "Tech" }],
    },
    {
      match: /\/users$/,
      raw: true,
      reply: () => ({ success: true, data: [{ id: "t1", firstName: "Tess", lastName: "Tech", email: "tess@example.com" }], pagination: {} }),
    },
  ];
}
