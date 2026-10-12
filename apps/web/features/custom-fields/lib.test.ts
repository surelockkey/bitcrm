import { describe, it, expect } from "vitest";
import type { CustomFieldDefinition } from "@bitcrm/types";
import {
  applicableFields,
  clientCustomFields,
  clientFieldColumns,
  customFieldAnswersPatch,
  customFieldControl,
  groupFields,
  isCustomFieldAnswerEmpty,
  jobCustomFields,
  missingRequiredCustomFields,
  reorderPriorities,
  stepTarget,
  workizGroupColumns,
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

  it("never offers a client field on a job", () => {
    const ids = applicableFields([...defs, field({ id: "client", entityType: "client" })], "jt-1").map((f) => f.id);
    expect(ids).not.toContain("client");
  });
});

/** Workiz's Settings → Custom Fields tabs: Job/Lead and Client. */
describe("jobCustomFields / clientCustomFields", () => {
  const defs = [
    field({ id: "legacy" }),
    field({ id: "job", entityType: "job" }),
    field({ id: "client", entityType: "client" }),
  ];

  it("a field without an entity is a job field", () => {
    expect(jobCustomFields(defs).map((f) => f.id)).toEqual(["legacy", "job"]);
    expect(clientCustomFields(defs).map((f) => f.id)).toEqual(["client"]);
    expect(jobCustomFields(undefined)).toEqual([]);
  });
});

/**
 * Workiz orders a group's fields by dragging (B10). The order IS the stored
 * priority (higher first): after a move the group is renumbered n…1 from the
 * top, and only the rows whose priority changes are written.
 */
describe("reorderPriorities", () => {
  const list = [
    field({ id: "a", priority: 3 }),
    field({ id: "b", priority: 2 }),
    field({ id: "c", priority: 1 }),
  ];

  it("moves a row into another's slot and writes only the rows that change", () => {
    expect(reorderPriorities(list, "c", "a")).toEqual([
      { id: "c", priority: 3 },
      { id: "a", priority: 2 },
      { id: "b", priority: 1 },
    ]);
    expect(reorderPriorities(list, "a", "b")).toEqual([
      { id: "b", priority: 3 },
      { id: "a", priority: 2 },
    ]);
  });

  it("numbers a group that was never ordered (all 0) from the top", () => {
    const flat = [field({ id: "x" }), field({ id: "y" }), field({ id: "z" })];
    expect(reorderPriorities(flat, "z", "y")).toEqual([
      { id: "x", priority: 3 },
      { id: "z", priority: 2 },
      { id: "y", priority: 1 },
    ]);
  });

  it("writes nothing for a drop on itself or an unknown row", () => {
    expect(reorderPriorities(list, "a", "a")).toEqual([]);
    expect(reorderPriorities(list, "a", "nope")).toEqual([]);
  });
});

describe("stepTarget — the keyboard's move up / move down", () => {
  const list = [field({ id: "a" }), field({ id: "b" }), field({ id: "c" })];

  it("names the neighbour to swap with, none past either end", () => {
    expect(stepTarget(list, "b", -1)).toBe("a");
    expect(stepTarget(list, "b", 1)).toBe("c");
    expect(stepTarget(list, "a", -1)).toBeUndefined();
    expect(stepTarget(list, "c", 1)).toBeUndefined();
  });
});

/**
 * The client page's Custom fields tab (pg_contact_wz_269669_tab_custom-fields):
 * Work Order on the left, Platinum Info on the right, Extra Info (Workiz's
 * ungrouped bucket) last, under Work Order — the groups taking the two
 * columns in turn; active client fields only, priority order within a group.
 */
describe("clientFieldColumns", () => {
  const defs = [
    field({ id: "gd", name: "Google Drive Link", group: "Extra Info", priority: 1, entityType: "client" }),
    field({ id: "pc", name: "Platinum Company name", group: "Extra Info", priority: 2, entityType: "client" }),
    field({ id: "pl", name: "Platinum", group: "Platinum Info", priority: 1, entityType: "client" }),
    field({ id: "v2", name: "Vendor N 2", group: "Work Order", priority: 1, entityType: "client" }),
    field({ id: "wo", name: "Work Order", group: "Work Order", priority: 3, entityType: "client" }),
    field({ id: "v1", name: "Vendor Number 1", group: "Work Order", priority: 2, entityType: "client" }),
    field({ id: "off", name: "Old", group: "Work Order", active: false, entityType: "client" }),
    field({ id: "job", name: "Gate Code", group: "Work Order" }),
  ];

  it("lays the groups out as Workiz does", () => {
    const [left, right] = clientFieldColumns(defs);
    expect(left.map((g) => g.group)).toEqual(["Work Order", "Extra Info"]);
    expect(right.map((g) => g.group)).toEqual(["Platinum Info"]);
    expect(left[0].fields.map((f) => f.id)).toEqual(["wo", "v1", "v2"]);
    expect(left[1].fields.map((f) => f.id)).toEqual(["pc", "gd"]);
  });

  it("puts other groups alphabetically between Workiz's and the ungrouped bucket", () => {
    const [left, right] = clientFieldColumns([
      field({ id: "z", group: "Zeta", entityType: "client" }),
      field({ id: "u", group: "", entityType: "client" }),
      field({ id: "a", group: "Access", entityType: "client" }),
    ]);
    expect(left.map((g) => g.group)).toEqual(["Access", "Other"]);
    expect(right.map((g) => g.group)).toEqual(["Zeta"]);
  });
});

/** What the client card's Save sends: the answers that changed, a cleared one as null. */
describe("customFieldAnswersPatch", () => {
  it("sends changed and new answers, null for a cleared one, nothing for the untouched", () => {
    expect(
      customFieldAnswersPatch(
        { a: "1", b: "keep", c: ["x"], d: "gone" },
        { a: "2", b: "keep", c: ["x"], e: true },
      ),
    ).toEqual({ a: "2", d: null, e: true });
  });

  it("is empty when nothing changed (Save stays off)", () => {
    expect(customFieldAnswersPatch({ c: ["x", "y"] }, { c: ["x", "y"] })).toEqual({});
    expect(customFieldAnswersPatch(undefined, {})).toEqual({});
  });

  it("treats a blank answer as no answer", () => {
    expect(customFieldAnswersPatch({ a: "1" }, { a: "" })).toEqual({ a: null });
    expect(customFieldAnswersPatch({}, { a: "", b: [] })).toEqual({});
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

/**
 * new_01_empty_scroll1 / job_b_01_details_scroll1: Extra Info, Dispatchers and
 * Platinum stand in the left column, Other Contact and Tech in the right —
 * by name, so a catalog missing one of them (dev has no "Other Contact")
 * does not slide the rest over (app_audit #7).
 */
describe("workizGroupColumns", () => {
  const g = (group: string) => ({ group, fields: [] });

  it("puts Workiz's groups in Workiz's columns", () => {
    const [left, right] = workizGroupColumns([g("Extra Info"), g("Other Contact"), g("Dispatchers"), g("Tech"), g("Platinum")]);
    expect(left.map((x) => x.group)).toEqual(["Extra Info", "Dispatchers", "Platinum"]);
    expect(right.map((x) => x.group)).toEqual(["Other Contact", "Tech"]);
  });

  it("keeps them there when one is missing", () => {
    const [left, right] = workizGroupColumns([g("Extra Info"), g("Dispatchers"), g("Tech"), g("Platinum")]);
    expect(left.map((x) => x.group)).toEqual(["Extra Info", "Dispatchers", "Platinum"]);
    expect(right.map((x) => x.group)).toEqual(["Tech"]);
  });

  it("fills the column with fewer groups with the ones Workiz has no place for, left on a tie", () => {
    const [left, right] = workizGroupColumns([g("Extra Info"), g("Dispatchers"), g("Tech"), g("Platinum"), g("Need to order"), g("Work Order"), g("Zeta")]);
    expect(left.map((x) => x.group)).toEqual(["Extra Info", "Dispatchers", "Platinum", "Zeta"]);
    expect(right.map((x) => x.group)).toEqual(["Tech", "Need to order", "Work Order"]);
    expect(workizGroupColumns([g("Access")])).toEqual([[g("Access")], []]);
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
    // new_01_empty_scroll1 / job_b_01_details_scroll1: Extra Info | Other
    // Contact, Dispatchers | Tech, Platinum — Extra Info leads on both pages.
    expect(groups.map((g) => g.group)).toEqual(["Extra Info", "Tech", "Need To Order", "Zeta"]);
  });
});

describe("customFieldControl — which Workiz control draws each type", () => {
  it("maps every custom-field type to a kit control", () => {
    expect(customFieldControl("text")).toBe("text");
    expect(customFieldControl("number")).toBe("number");
    expect(customFieldControl("large_text")).toBe("textarea");
    expect(customFieldControl("dropdown")).toBe("select");
    expect(customFieldControl("multi_select")).toBe("multiselect");
    expect(customFieldControl("checkbox")).toBe("checkbox");
    expect(customFieldControl("date")).toBe("date");
    expect(customFieldControl("file")).toBe("upload");
  });

  it("draws an unknown (newer) type as a text box rather than nothing", () => {
    expect(customFieldControl("signature" as never)).toBe("text");
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
