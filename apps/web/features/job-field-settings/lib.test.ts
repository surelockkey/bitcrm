import { describe, it, expect } from "vitest";
import type { JobFieldSettings } from "@bitcrm/types";
import { missingRequiredJobFields, restoredJobFieldSettings } from "./lib";

const settings = (required: Record<string, boolean>): JobFieldSettings => ({
  requiredFields: required,
});

const values = {
  address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
  serviceArea: "Phoenix",
  jobTypeId: "jt-1",
  sourceId: "",
  externalCompanyId: "",
  scheduledDate: "",
  notes: "",
  poNumber: "",
  tagIds: [] as string[],
};

const client = {
  firstName: "Nova",
  lastName: "Reyes",
  company: "",
  phone: "+14045551234",
  secondaryPhone: "",
  email: "",
  hasAddress: true,
};

/**
 * Workiz's Field Validation rows on the New Job form, in Workiz's words: each
 * missing one says "Required field" under its box and is named in the
 * summary. "External Company or Ad Group" is one rule either field satisfies.
 */
describe("missingRequiredJobFields", () => {
  it("does not block while the settings are still loading", () => {
    expect(missingRequiredJobFields(undefined, { values, client })).toEqual([]);
  });

  it("lists the admin-required fields the form leaves empty, in the page's order", () => {
    const out = missingRequiredJobFields(settings({ phone: true, source: true, scheduled: true, email: true }), {
      values,
      client: { ...client, phone: "", email: "" },
    });
    expect(out).toEqual([
      { id: "phone", label: "Primary Phone" },
      { id: "email", label: "Email Address" },
      { id: "source", label: "Job source" },
      { id: "scheduled", label: "Scheduled date" },
    ]);
  });

  it("First / Last Name, Client Company Name and Secondary Phone read the client typed or picked", () => {
    const required = settings({ firstName: true, lastName: true, companyName: true, secondaryPhone: true });
    expect(missingRequiredJobFields(required, { values, client: { ...client, lastName: "", company: "" } }).map((f) => f.label)).toEqual([
      "Last Name",
      "Client Company Name",
      "Secondary Phone",
    ]);
    expect(
      missingRequiredJobFields(required, {
        values,
        client: { ...client, company: "Acme Locks", secondaryPhone: "+14045550000" },
      }),
    ).toEqual([]);
  });

  it("'External Company or Ad Group' is satisfied by either one", () => {
    const required = settings({ externalCompanyOrSource: true });
    expect(missingRequiredJobFields(required, { values, client })).toEqual([
      { id: "externalCompanyOrSource", label: "External Company or Ad Group" },
    ]);
    expect(missingRequiredJobFields(required, { values: { ...values, sourceId: "src-1" }, client })).toEqual([]);
    expect(missingRequiredJobFields(required, { values: { ...values, externalCompanyId: "ext-1" }, client })).toEqual([]);
  });

  it("Client Address is the client's own, or the service location typed for them; Job Address is the location", () => {
    const required = settings({ clientAddress: true, address: true });
    const noLocation = { ...values, address: { street: "", city: "", state: "", zip: "" } };
    expect(missingRequiredJobFields(required, { values: noLocation, client: { ...client, hasAddress: false } }).map((f) => f.label)).toEqual([
      "Client Address",
      "Job Address",
    ]);
    expect(missingRequiredJobFields(required, { values: noLocation, client }).map((f) => f.label)).toEqual(["Job Address"]);
    expect(missingRequiredJobFields(required, { values, client: { ...client, hasAddress: false } })).toEqual([]);
  });

  it("is quiet when everything required is filled", () => {
    const out = missingRequiredJobFields(settings({ source: true, tags: true, description: true, firstName: true }), {
      values: { ...values, sourceId: "src-1", tagIds: ["t1"], notes: "Broken latch" },
      client,
    });
    expect(out).toEqual([]);
  });

  it("counts a picked external company", () => {
    const required = settings({ externalCompany: true });
    expect(missingRequiredJobFields(required, { values, client })).toEqual([{ id: "externalCompany", label: "External company" }]);
    expect(missingRequiredJobFields(required, { values: { ...values, externalCompanyId: "x1" }, client })).toEqual([]);
  });
});

/** Workiz's "Restore Default Settings": every row back to its default — ours, the job address and type. */
describe("restoredJobFieldSettings", () => {
  it("switches every row off but the defaults", () => {
    const { requiredFields } = restoredJobFieldSettings();
    expect(requiredFields.address).toBe(true);
    expect(requiredFields.jobType).toBe(true);
    expect(requiredFields.firstName).toBe(false);
    expect(requiredFields.externalCompanyOrSource).toBe(false);
    expect(Object.keys(requiredFields)).toContain("secondaryPhone");
  });
});
