import { describe, it, expect } from "vitest";
import type { CustomFieldDefinition } from "@bitcrm/types";
import {
  applicableFields,
  groupFields,
  isCustomFieldAnswerEmpty,
  missingRequiredCustomFields,
  workizOrderedGroups,
} from "./lib";

function field(over: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "cf-1",
    name: "Field",
    type: "text",
    group: "Details",
    options: [],
    jobTypeIds: [],
    required: false,
    requiredToClose: false,
    searchable: false,
    priority: 0,
    active: true,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("applicableFields", () => {
  const defs = [
    field({ id: "all", jobTypeIds: [] }),
    field({ id: "jt1", jobTypeIds: ["jt-1"] }),
    field({ id: "jt2", jobTypeIds: ["jt-2"] }),
    field({ id: "archived", jobTypeIds: [], active: false }),
  ];

  it("keeps active fields scoped to the job type or to all job types", () => {
    expect(applicableFields(defs, "jt-1").map((f) => f.id)).toEqual(["all", "jt1"]);
  });

  it("drops archived fields and fields scoped to other job types", () => {
    const ids = applicableFields(defs, "jt-2").map((f) => f.id);
    expect(ids).toContain("all");
    expect(ids).toContain("jt2");
    expect(ids).not.toContain("jt1");
    expect(ids).not.toContain("archived");
  });

  it("tolerates an undefined catalog", () => {
    expect(applicableFields(undefined, "jt-1")).toEqual([]);
  });
});

describe("groupFields", () => {
  it("buckets by group, sorts groups alpha with Other last, fields by priority then name", () => {
    const groups = groupFields([
      field({ id: "b", name: "Beta", group: "Zeta", priority: 0 }),
      field({ id: "a", name: "Alpha", group: "Alpha", priority: 1 }),
      field({ id: "o", name: "Orphan", group: "" }),
      field({ id: "a2", name: "Alfie", group: "Alpha", priority: 1 }),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["Alpha", "Zeta", "Other"]);
    // Same priority → name ascending.
    expect(groups[0].fields.map((f) => f.name)).toEqual(["Alfie", "Alpha"]);
  });
});

describe("workizOrderedGroups", () => {
  it("orders groups as on the Workiz form, unknown groups after", () => {
    const groups = workizOrderedGroups([
      field({ id: "n", name: "Item", group: "Need To Order" }),
      field({ id: "z", name: "Custom", group: "Zeta" }),
      field({ id: "t", name: "Parts Image", group: "Tech" }),
      field({ id: "e", name: "Jobs Dispatch", group: "Extra Info" }),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["Extra Info", "Tech", "Need To Order", "Zeta"]);
  });
});

describe("isCustomFieldAnswerEmpty", () => {
  it("treats undefined, blank strings, empty arrays and false as empty", () => {
    expect(isCustomFieldAnswerEmpty(undefined)).toBe(true);
    expect(isCustomFieldAnswerEmpty("")).toBe(true);
    expect(isCustomFieldAnswerEmpty("   ")).toBe(true);
    expect(isCustomFieldAnswerEmpty([])).toBe(true);
    expect(isCustomFieldAnswerEmpty(false)).toBe(true);
  });

  it("treats real answers — including 0 and true — as present", () => {
    expect(isCustomFieldAnswerEmpty(0)).toBe(false);
    expect(isCustomFieldAnswerEmpty(42)).toBe(false);
    expect(isCustomFieldAnswerEmpty("x")).toBe(false);
    expect(isCustomFieldAnswerEmpty(["A"])).toBe(false);
    expect(isCustomFieldAnswerEmpty(true)).toBe(false);
  });
});

describe("missingRequiredCustomFields", () => {
  const defs = [
    field({ id: "req", name: "Required", required: true }),
    field({ id: "opt", name: "Optional", required: false }),
    field({ id: "req-other", name: "OtherJob", required: true, jobTypeIds: ["jt-2"] }),
  ];

  it("returns required applicable fields with no answer", () => {
    expect(missingRequiredCustomFields(defs, "jt-1", {}).map((f) => f.id)).toEqual(["req"]);
  });

  it("is satisfied once every required applicable field has an answer", () => {
    expect(missingRequiredCustomFields(defs, "jt-1", { req: "yes" })).toEqual([]);
  });

  it("ignores required fields scoped to a different job type", () => {
    expect(missingRequiredCustomFields(defs, "jt-1", { req: "yes" }).map((f) => f.id)).toEqual([]);
  });
});
