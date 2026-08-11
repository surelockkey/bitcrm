import { describe, it, expect } from "vitest";
import {
  JOB_FIELDS,
  DEFAULT_VISIBLE,
  sanitizeVisibleFields,
  type JobFieldId,
} from "./fields";

describe("JOB_FIELDS", () => {
  it("lists the hideable columns in table order with human labels", () => {
    expect(JOB_FIELDS.map((f) => f.id)).toEqual([
      "client",
      "tech",
      "tags",
      "location",
      "scheduled",
      "jobType",
    ]);
    expect(JOB_FIELDS.map((f) => f.label)).toEqual([
      "Client",
      "Tech",
      "Tags",
      "Location",
      "Scheduled",
      "Job type",
    ]);
  });

  it("does not offer the job number — that column can't be hidden", () => {
    expect(JOB_FIELDS.some((f) => (f.id as string) === "number")).toBe(false);
  });
});

describe("DEFAULT_VISIBLE", () => {
  it("shows every field out of the box", () => {
    for (const f of JOB_FIELDS) expect(DEFAULT_VISIBLE[f.id]).toBe(true);
    expect(Object.keys(DEFAULT_VISIBLE)).toHaveLength(JOB_FIELDS.length);
  });
});

describe("sanitizeVisibleFields", () => {
  it("returns defaults for garbage input", () => {
    expect(sanitizeVisibleFields(null)).toEqual(DEFAULT_VISIBLE);
    expect(sanitizeVisibleFields(undefined)).toEqual(DEFAULT_VISIBLE);
    expect(sanitizeVisibleFields("nope")).toEqual(DEFAULT_VISIBLE);
    expect(sanitizeVisibleFields(42)).toEqual(DEFAULT_VISIBLE);
  });

  it("keeps stored false flags and fills missing fields with defaults", () => {
    const out = sanitizeVisibleFields({ tags: false });
    expect(out.tags).toBe(false);
    for (const f of JOB_FIELDS.filter((f) => f.id !== "tags")) {
      expect(out[f.id]).toBe(true);
    }
  });

  it("drops keys that are no longer real fields", () => {
    const out = sanitizeVisibleFields({ tags: false, legacyColumn: false });
    expect("legacyColumn" in out).toBe(false);
    expect(out.tags).toBe(false);
  });

  it("replaces non-boolean values with the default", () => {
    const out = sanitizeVisibleFields({ tech: "false", tags: 0 });
    expect(out.tech).toBe(true);
    expect(out.tags).toBe(true);
  });

  it("never returns the same object it was given", () => {
    const raw: Partial<Record<JobFieldId, boolean>> = { client: false };
    const out = sanitizeVisibleFields(raw);
    expect(out).not.toBe(raw);
  });
});
