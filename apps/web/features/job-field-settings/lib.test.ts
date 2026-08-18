import { describe, it, expect } from "vitest";
import type { JobFieldSettings } from "@bitcrm/types";
import { missingRequiredJobFields } from "./lib";

const settings = (required: Record<string, boolean>): JobFieldSettings => ({
  requiredFields: required,
});

const values = {
  address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
  serviceArea: "Phoenix",
  jobTypeId: "jt-1",
  sourceId: "",
  scheduledDate: "",
  notes: "",
  poNumber: "",
  tagIds: [] as string[],
};

describe("missingRequiredJobFields", () => {
  it("does not block while the settings are still loading", () => {
    expect(missingRequiredJobFields(undefined, { values })).toEqual([]);
  });

  it("lists the admin-required fields the form leaves empty, in registry order", () => {
    const out = missingRequiredJobFields(
      settings({ phone: true, source: true, scheduled: true }),
      { values, clientPhone: "", clientEmail: "" },
    );
    expect(out).toEqual(["Client phone", "Job source", "Scheduled date"]);
  });

  it("checks the client's phone and email from the resolved contact or draft", () => {
    const out = missingRequiredJobFields(settings({ phone: true, email: true }), {
      values,
      clientPhone: "+14045551234",
      clientEmail: "",
    });
    expect(out).toEqual(["Client email"]);
  });

  it("is quiet when everything required is filled", () => {
    const out = missingRequiredJobFields(
      settings({ source: true, tags: true, description: true }),
      {
        values: { ...values, sourceId: "src-1", tagIds: ["t1"], notes: "Broken latch" },
      },
    );
    expect(out).toEqual([]);
  });
});
