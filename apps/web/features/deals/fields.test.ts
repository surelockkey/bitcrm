import { describe, it, expect } from "vitest";
import type { CustomFieldDefinition } from "@bitcrm/types";
import {
  DEFAULT_VISIBLE,
  JOB_FIELDS,
  customFieldColumnId,
  formatCustomFieldValue,
  jobFieldOptions,
  sanitizeVisibleFields,
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

  it("keeps the classic columns on by default and the new ones off", () => {
    for (const id of ["client", "tech", "tags", "city", "state", "scheduled", "jobType"]) {
      expect(DEFAULT_VISIBLE[id]).toBe(true);
    }
    for (const id of ["phone", "source", "poNumber", "createdAt"]) {
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
      { id: "cf:cf-b", label: "Alarm" },
      { id: "cf:cf-a", label: "Gate Code" },
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
