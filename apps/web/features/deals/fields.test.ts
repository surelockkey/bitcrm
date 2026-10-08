import { describe, it, expect } from "vitest";
import type { CustomFieldDefinition } from "@bitcrm/types";
import {
  DEFAULT_VISIBLE,
  JOB_FIELDS,
  customFieldColumnId,
  formatCustomFieldValue,
  jobFieldOptions,
  sanitizeFieldOrder,
  sanitizeVisibleFields,
  orderedColumns,
  draftFromSaved,
  toggleDraft,
  moveDraft,
  panelLists,
  savedFromDraft,
  CUSTOM_FIELD_WIDTH,
} from "./fields";

const ids = JOB_FIELDS.map((f) => f.id) as string[];

describe("JOB_FIELDS registry", () => {
  it("covers every displayable deal field, not just the classic six", () => {
    for (const id of [
      "client",
      "phone",
      "email",
      "clientType",
      "tech",
      "dispatcher",
      "tags",
      "status",
      "priority",
      "city",
      "state",
      "zip",
      "address",
      "serviceArea",
      "scheduled",
      "jobType",
      "source",
      "externalCompany",
      "company",
      "poNumber",
      "total",
      "paymentStatus",
      "notes",
      "createdBy",
      "createdAt",
    ]) {
      expect(ids).toContain(id);
    }
  });

  /**
   * Workiz's USED FIELDS on this account (list_02_fields_menu): Job ID,
   * Client, Tech, Tags, City, State, Scheduled, Job Type, Zip code, Total
   * Price, Choose Company — a migrating dispatcher starts with the same set
   * (audit L16).
   */
  it("starts with Workiz's used fields on, in Workiz's order, and the rest off", () => {
    expect(Object.keys(DEFAULT_VISIBLE).filter((id) => DEFAULT_VISIBLE[id])).toEqual([
      "client",
      "tech",
      "tags",
      "city",
      "state",
      "scheduled",
      "jobType",
      "zip",
      "total",
      "company",
    ]);
    for (const id of ["phone", "source", "externalCompany", "poNumber", "createdAt"]) {
      expect(DEFAULT_VISIBLE[id]).toBe(false);
    }
  });

  it("appends active custom fields (by priority) as cf: options", () => {
    const defs = [
      { id: "cf-a", name: "Gate Code", priority: 1, active: true },
      { id: "cf-b", name: "Alarm", priority: 9, active: true },
      { id: "cf-c", name: "Old", priority: 5, active: false },
    ] as CustomFieldDefinition[];

    const options = jobFieldOptions(defs);
    const tail = options.slice(-2);
    expect(tail).toEqual([
      { id: "cf:cf-b", label: "Alarm", width: CUSTOM_FIELD_WIDTH, icon: "custom" },
      { id: "cf:cf-a", label: "Gate Code", width: CUSTOM_FIELD_WIDTH, icon: "custom" },
    ]);
    expect(options.map((o) => o.id)).not.toContain("cf:cf-c");
  });
});

describe("sanitizeVisibleFields", () => {
  it("keeps custom-field keys, drops junk, defaults the rest", () => {
    const out = sanitizeVisibleFields({
      client: false,
      "cf:cf-a": true,
      bogus: true,
      scheduled: "yes",
    });
    expect(out.client).toBe(false);
    expect(out[customFieldColumnId("cf-a")]).toBe(true);
    expect(out).not.toHaveProperty("bogus");
    expect(out.scheduled).toBe(DEFAULT_VISIBLE.scheduled);
  });

  it("migrates the legacy 'location' key into city + state", () => {
    const out = sanitizeVisibleFields({ location: false });
    expect(out.city).toBe(false);
    expect(out.state).toBe(false);
    expect(out).not.toHaveProperty("location");
  });
});

describe("formatCustomFieldValue", () => {
  it("renders answers per type", () => {
    expect(formatCustomFieldValue(undefined)).toBe("—");
    expect(formatCustomFieldValue("")).toBe("—");
    expect(formatCustomFieldValue(true)).toBe("Yes");
    expect(formatCustomFieldValue(false)).toBe("No");
    expect(formatCustomFieldValue(["a", "b"])).toBe("a, b");
    expect(formatCustomFieldValue(4417)).toBe("4417");
    expect(formatCustomFieldValue("code")).toBe("code");
  });
});

/**
 * Workiz names its columns in its own words, and a dispatcher reads them in
 * the Visible fields panel every day (list_02_fields_menu). Ours keep the
 * same words for the same thing, and offer the two Workiz columns we can
 * fill: End (the visit's end) and Time in Status.
 */
describe("Workiz field names", () => {
  const label = (id: string) => JOB_FIELDS.find((f) => f.id === id)?.label;

  it("names the shared fields the way Workiz's panel does", () => {
    expect(label("jobType")).toBe("Job Type");
    expect(label("total")).toBe("Total Price");
    expect(label("externalCompany")).toBe("External Company");
    expect(label("zip")).toBe("Zip code");
    expect(label("serviceArea")).toBe("Service area");
    expect(label("createdBy")).toBe("Created by");
    // The company the job is done under — Workiz's "Choose Company" (audit_pixels L17).
    expect(label("company")).toBe("Choose Company");
  });

  it("offers End, Time in Status and Job name, off by default", () => {
    expect(label("end")).toBe("End");
    expect(label("timeInStatus")).toBe("Time in Status");
    expect(label("jobName")).toBe("Job name");
    expect(DEFAULT_VISIBLE.end).toBe(false);
    expect(DEFAULT_VISIBLE.timeInStatus).toBe(false);
    expect(DEFAULT_VISIBLE.jobName).toBe(false);
  });

  it("gives every option the icon the panel draws at its right", () => {
    for (const o of jobFieldOptions([])) expect(o.icon, o.id).toBeTruthy();
    const icon = (id: string) => jobFieldOptions([]).find((o) => o.id === id)?.icon;
    expect(icon("client")).toBe("users");
    expect(icon("tech")).toBe("users");
    expect(icon("tags")).toBe("tag");
    expect(icon("city")).toBe("location");
    expect(icon("scheduled")).toBe("calendar");
    expect(icon("jobType")).toBe("job");
    expect(icon("total")).toBe("money");
  });
});

const opts = (...ids: string[]) => ids.map((id) => ({ id, label: id, width: 100, icon: "job" as const }));

describe("orderedColumns — the columns, in the order the reader saved", () => {
  const options = opts("client", "tech", "tags", "city", "cf:x");

  it("without a saved order keeps the registry order of what is visible", () => {
    const visible = { client: true, tech: false, tags: true, city: true };
    expect(orderedColumns(options, visible, []).map((c) => c.id)).toEqual(["client", "tags", "city"]);
  });

  it("puts the saved order first, then visible fields the order does not know yet", () => {
    const visible = { client: true, tech: true, tags: true, city: true };
    expect(orderedColumns(options, visible, ["city", "client"]).map((c) => c.id)).toEqual([
      "city",
      "client",
      "tech",
      "tags",
    ]);
  });

  it("skips ids the order names that are hidden or no longer offered", () => {
    const visible = { client: true, city: true, gone: true };
    expect(orderedColumns(options, visible, ["gone", "tech", "city", "client"]).map((c) => c.id)).toEqual([
      "city",
      "client",
    ]);
  });
});

describe("the Visible fields panel's draft", () => {
  const options = opts("client", "tech", "tags", "city", "state");

  it("starts from the saved columns, in their order", () => {
    expect(draftFromSaved(options, { client: true, tags: true, city: true }, ["city"])).toEqual([
      "city",
      "client",
      "tags",
    ]);
  });

  it("a newly ticked field goes to the end of USED FIELDS", () => {
    expect(toggleDraft(["client", "tags"], "state")).toEqual(["client", "tags", "state"]);
  });

  it("an unticked field leaves USED FIELDS", () => {
    expect(toggleDraft(["client", "tags", "state"], "tags")).toEqual(["client", "state"]);
  });

  it("dragging moves a field to another slot", () => {
    expect(moveDraft(["client", "tech", "tags", "city"], "city", "tech")).toEqual([
      "client",
      "city",
      "tech",
      "tags",
    ]);
    expect(moveDraft(["client", "tech", "tags"], "client", "tags")).toEqual(["tech", "tags", "client"]);
    // A drop on itself, or on something not in the list, changes nothing.
    expect(moveDraft(["client", "tech"], "tech", "tech")).toEqual(["client", "tech"]);
    expect(moveDraft(["client", "tech"], "tech", "nope")).toEqual(["client", "tech"]);
  });

  it("splits the options into USED (draft order) and UNSELECTED (registry order), both searchable", () => {
    const named = [
      { id: "client", label: "Client", width: 1, icon: "users" as const },
      { id: "tech", label: "Tech", width: 1, icon: "users" as const },
      { id: "city", label: "City", width: 1, icon: "location" as const },
      { id: "state", label: "State", width: 1, icon: "location" as const },
    ];
    const all = panelLists(named, ["city", "client"], "");
    expect(all.used.map((o) => o.id)).toEqual(["city", "client"]);
    expect(all.unselected.map((o) => o.id)).toEqual(["tech", "state"]);

    const found = panelLists(named, ["city", "client"], "  CI ");
    expect(found.used.map((o) => o.id)).toEqual(["city"]);
    expect(found.unselected.map((o) => o.id)).toEqual([]);
  });

  it("saving turns the draft into a visibility map over every option and the column order", () => {
    expect(savedFromDraft(options, ["city", "client"])).toEqual({
      visible: { client: true, tech: false, tags: false, city: true, state: false },
      order: ["city", "client"],
    });
  });
});

describe("sanitizeFieldOrder", () => {
  it("keeps distinct strings and drops everything else", () => {
    expect(sanitizeFieldOrder(["city", 3, "city", null, "cf:a", ""])).toEqual(["city", "cf:a"]);
    expect(sanitizeFieldOrder("nope")).toEqual([]);
    expect(sanitizeFieldOrder(undefined)).toEqual([]);
  });
});
