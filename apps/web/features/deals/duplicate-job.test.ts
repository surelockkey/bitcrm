import { describe, expect, it } from "vitest";
import { DealPriority, type CustomFieldDefinition, type Deal } from "@bitcrm/types";
import { duplicateJobHref, duplicatePrefill } from "./duplicate-job";

const job = {
  id: "deal-1",
  dealNumber: "5TU7ZA",
  contactId: "c-dustin",
  address: { street: "Princeton", unit: "Apt 2", city: "Princeton", state: "TX", zip: "75407", country: "US", lat: 33.18, lng: -96.5 },
  jobTypeId: "jt-lockout",
  jobName: "Front door",
  serviceArea: "TX Dallas",
  serviceAreaId: "sa-dallas",
  priority: DealPriority.URGENT,
  sourceId: "src-google",
  externalCompanyId: "ext-1",
  businessProfileId: "bp-2",
  notes: "<p>Gate code 1234</p>",
  tagIds: ["t-vip", "t-archived", "t-gone"],
  customFields: { cf_vendor: "Platinum", cf_photos: ["att-1", "att-2"], cf_po: "PO-77", cf_old: "x" },
  // What a duplicate never takes along.
  scheduledDate: "2026-10-08",
  scheduledEndDate: "2026-10-08",
  scheduledTimeSlot: "08:00-09:00",
  assignedTechIds: ["tech-1"],
  workOrderId: "wo-1",
  poNumber: "PO-1",
} as unknown as Deal;

const defs: Array<Pick<CustomFieldDefinition, "id" | "type" | "active">> = [
  { id: "cf_vendor", type: "text", active: true },
  { id: "cf_photos", type: "file", active: true },
  { id: "cf_po", type: "text", active: true },
  { id: "cf_old", type: "text", active: false },
];
const tags = [
  { id: "t-vip", active: true },
  { id: "t-archived", active: false },
];

describe("Duplicate Job (Workiz job Actions → Duplicate Job)", () => {
  it("opens New Job on the job it copies", () => {
    expect(duplicateJobHref("deal-1")).toBe("/deals/new?duplicate=deal-1");
  });

  it("copies the job's details into the New Job form — the same place, type, source, area, company and words", () => {
    const p = duplicatePrefill(job, { customFieldDefs: defs, jobTags: tags });
    expect(p.contactId).toBe("c-dustin");
    expect(p.values).toEqual({
      jobTypeId: "jt-lockout",
      jobName: "Front door",
      serviceAreaId: "sa-dallas",
      address: { street: "Princeton", unit: "Apt 2", city: "Princeton", state: "TX", zip: "75407", country: "US", lat: 33.18, lng: -96.5 },
      priority: DealPriority.URGENT,
      sourceId: "src-google",
      externalCompanyId: "ext-1",
      notes: "<p>Gate code 1234</p>",
    });
    expect(p.businessProfileId).toBe("bp-2");
  });

  it("takes the tags still in use, and the custom-field answers — but not the files, which belong to the old job", () => {
    const p = duplicatePrefill(job, { customFieldDefs: defs, jobTags: tags });
    expect(p.tagIds).toEqual(["t-vip"]);
    expect(p.customFields).toEqual({ cf_vendor: "Platinum", cf_po: "PO-77" });
  });

  it("never carries the visit, the team or the work order — those are the new visit's own", () => {
    const p = duplicatePrefill(job, { customFieldDefs: defs, jobTags: tags });
    const all = JSON.stringify(p);
    for (const key of ["scheduledDate", "scheduledTimeSlot", "assignedTechIds", "workOrderId", "poNumber"]) {
      expect(all).not.toContain(key);
    }
  });

  it("leaves blanks where the job had nothing", () => {
    const bare = { ...job, jobName: undefined, sourceId: undefined, externalCompanyId: undefined, serviceAreaId: undefined, notes: undefined, businessProfileId: undefined, tagIds: [], customFields: undefined } as unknown as Deal;
    const p = duplicatePrefill(bare, { customFieldDefs: defs, jobTags: tags });
    expect(p.values).toMatchObject({ jobName: "", sourceId: "", externalCompanyId: "", serviceAreaId: "", notes: "" });
    expect(p.businessProfileId).toBeUndefined();
    expect(p.tagIds).toEqual([]);
    expect(p.customFields).toEqual({});
  });
});
