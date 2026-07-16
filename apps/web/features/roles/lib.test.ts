import { describe, it, expect } from "vitest";
import { DataScope, DealStage } from "@bitcrm/types";
import {
  isAllowed,
  setAllowed,
  applyRowPreset,
  normalizeMatrix,
  countGrants,
  diffCells,
  dominantScope,
  setAllScopes,
  priorityBetween,
  sortRolesByPriority,
  isTransitionAllowed,
  hasExactTransition,
  toggleTransition,
  toggleWildcardTo,
  toggleAllTransitions,
} from "./lib";

const schema = {
  deals: ["view", "create", "edit", "delete"],
  settings: ["view", "edit"],
  skills: ["view", "propose", "approve", "revoke"],
} as const;

describe("matrix cells", () => {
  it("treats missing keys as denied (deny-by-default)", () => {
    expect(isAllowed({}, "deals", "view")).toBe(false);
    expect(isAllowed({ deals: {} }, "deals", "view")).toBe(false);
    expect(isAllowed({ deals: { view: true } }, "deals", "view")).toBe(true);
  });

  it("setAllowed is immutable and toggles a single cell", () => {
    const before = { deals: { view: true } };
    const after = setAllowed(before, "deals", "create", true);
    expect(after.deals.create).toBe(true);
    expect(after.deals.view).toBe(true);
    expect(before.deals).not.toHaveProperty("create"); // original untouched
  });
});

describe("presets", () => {
  it("row preset 'view' grants only view", () => {
    const m = applyRowPreset({}, "deals", schema.deals, "view");
    expect(m.deals).toEqual({ view: true, create: false, edit: false, delete: false });
  });
  it("row preset 'full' grants everything valid for the resource", () => {
    const m = applyRowPreset({}, "skills", schema.skills, "full");
    expect(m.skills).toEqual({ view: true, propose: true, approve: true, revoke: true });
  });
  it("row preset 'none' denies everything", () => {
    const m = applyRowPreset({ deals: { view: true, edit: true } }, "deals", schema.deals, "none");
    expect(Object.values(m.deals).every((v) => v === false)).toBe(true);
  });
});

describe("normalize / count / diff", () => {
  it("normalizeMatrix fills every valid cell with an explicit boolean", () => {
    const m = normalizeMatrix({ deals: { view: true } }, schema);
    expect(m).toEqual({
      deals: { view: true, create: false, edit: false, delete: false },
      settings: { view: false, edit: false },
      skills: { view: false, propose: false, approve: false, revoke: false },
    });
  });
  it("countGrants counts only granted valid cells", () => {
    expect(countGrants({ deals: { view: true, edit: true } }, schema)).toBe(2);
  });
  it("diffCells counts differing cells across the schema", () => {
    const a = { deals: { view: true } };
    const b = { deals: { view: true, edit: true } };
    expect(diffCells(a, b, schema)).toBe(1);
  });
});

describe("data scope", () => {
  it("dominantScope returns the most common scope", () => {
    expect(
      dominantScope({ a: DataScope.ALL, b: DataScope.ALL, c: DataScope.DEPARTMENT }),
    ).toBe(DataScope.ALL);
  });
  it("setAllScopes sets every resource to one scope", () => {
    const out = setAllScopes(["deals", "contacts"], DataScope.DEPARTMENT);
    expect(out).toEqual({ deals: DataScope.DEPARTMENT, contacts: DataScope.DEPARTMENT });
  });
});

describe("priority placement", () => {
  it("returns a value strictly between two neighbors", () => {
    expect(priorityBetween(60, 40)).toBe(50);
  });
  it("clamps within (below, above)", () => {
    const p = priorityBetween(41, 40);
    expect(p).toBeGreaterThanOrEqual(40);
    expect(p).toBeLessThanOrEqual(41);
  });
  it("sortRolesByPriority orders high-to-low", () => {
    const roles = [{ priority: 20 }, { priority: 80 }, { priority: 40 }] as never[];
    expect(sortRolesByPriority(roles).map((r) => (r as { priority: number }).priority)).toEqual([
      80, 40, 20,
    ]);
  });
});

describe("deal-stage transitions", () => {
  it("exact transitions", () => {
    const list = ["assigned->en_route"];
    expect(hasExactTransition(list, DealStage.ASSIGNED, DealStage.EN_ROUTE)).toBe(true);
    expect(isTransitionAllowed(list, DealStage.ASSIGNED, DealStage.EN_ROUTE)).toBe(true);
    expect(isTransitionAllowed(list, DealStage.ASSIGNED, DealStage.ON_SITE)).toBe(false);
  });
  it("`*->to` wildcard allows from any source", () => {
    const list = ["*->canceled"];
    expect(isTransitionAllowed(list, DealStage.ASSIGNED, DealStage.CANCELED)).toBe(true);
    expect(isTransitionAllowed(list, DealStage.ON_SITE, DealStage.CANCELED)).toBe(true);
    expect(hasExactTransition(list, DealStage.ASSIGNED, DealStage.CANCELED)).toBe(false);
  });
  it("`*->*` allows everything", () => {
    const list = ["*->*"];
    expect(isTransitionAllowed(list, DealStage.NEW_LEAD, DealStage.COMPLETED)).toBe(true);
  });
  it("toggleTransition adds then removes an exact rule", () => {
    const added = toggleTransition([], DealStage.ASSIGNED, DealStage.EN_ROUTE);
    expect(added).toContain("assigned->en_route");
    const removed = toggleTransition(added, DealStage.ASSIGNED, DealStage.EN_ROUTE);
    expect(removed).not.toContain("assigned->en_route");
  });
  it("toggleWildcardTo and toggleAllTransitions manage wildcard rules", () => {
    expect(toggleWildcardTo([], DealStage.CANCELED)).toContain("*->canceled");
    expect(toggleAllTransitions([])).toContain("*->*");
  });
});
