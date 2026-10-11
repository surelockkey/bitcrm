import { describe, expect, it } from "vitest";
import { DataScope, RESOURCE_REGISTRY } from "@bitcrm/types";
import type { DataScopeRules } from "@bitcrm/types";
import { DEFAULT_ROLES } from "../../../../backend/services/user/src/roles/constants/default-roles";
import { SYSTEM_ROLES } from "@/lib/permissions/system-roles";
import {
  ONLY_ASSIGNED_RESOURCES,
  newRoleScope,
  onlyAssignedOf,
  onlyAssignedState,
  sameOnlyAssigned,
  withOnlyAssigned,
} from "./only-assigned";

const { ALL, DEPARTMENT, ASSIGNED_ONLY } = DataScope;

const every = (scope: DataScope, extra: DataScopeRules = {}): DataScopeRules => ({
  ...Object.fromEntries(ONLY_ASSIGNED_RESOURCES.map((r) => [r, scope])),
  ...extra,
});

/**
 * "Sees only jobs assigned to them" — the one switch left of the Advanced
 * tab. It stands for the data scope of exactly the resources the server
 * reads a scope of for job-bound records (permissions_completeness.md §
 * "Data scope"): jobs, their documents and payments, commission, the inbox
 * and team chat. Vans (`containers`) are not among them: their scope stays as
 * stored, so a technician keeps seeing only their own van.
 */
describe("ONLY_ASSIGNED_RESOURCES", () => {
  it("is the job-bound resources the server scopes, every one a registry resource", () => {
    expect([...ONLY_ASSIGNED_RESOURCES].sort()).toEqual([
      "commission",
      "deals",
      "estimates",
      "invoices",
      "messages",
      "payments",
      "team_chat",
    ]);
    for (const r of ONLY_ASSIGNED_RESOURCES) expect(Object.keys(RESOURCE_REGISTRY)).toContain(r);
  });
});

describe("onlyAssignedOf / onlyAssignedState", () => {
  it("is on when every one of them is assigned-only, whatever the rest says", () => {
    expect(onlyAssignedOf(every(ASSIGNED_ONLY, { contacts: ALL, containers: ALL }))).toBe(true);
    expect(onlyAssignedState(every(ASSIGNED_ONLY))).toEqual({ on: true, partly: [] });
  });

  it("is off when none is — department reads as all for them", () => {
    expect(onlyAssignedOf(every(ALL))).toBe(false);
    expect(onlyAssignedOf(every(DEPARTMENT))).toBe(false);
    expect(onlyAssignedState(every(DEPARTMENT, { contacts: ASSIGNED_ONLY }))).toEqual({ on: false, partly: [] });
  });

  it("is off but names the ones that are, when only some are (an imported 'Other Users Jobs' override)", () => {
    const state = onlyAssignedState(every(ALL, { deals: ASSIGNED_ONLY, messages: ASSIGNED_ONLY }));
    expect(state.on).toBe(false);
    expect(state.partly).toEqual(["deals", "messages"]);
  });

  it("reads a missing scope as not assigned-only (the editors' 'All' default)", () => {
    expect(onlyAssignedOf({})).toBe(false);
    const { deals: _dropped, ...rest } = every(ASSIGNED_ONLY);
    void _dropped;
    expect(onlyAssignedOf(rest)).toBe(false);
  });
});

describe("sameOnlyAssigned — whether two scopes put the switch in the same place", () => {
  it("is true for on/on and off/off, department and all alike", () => {
    expect(sameOnlyAssigned(every(ASSIGNED_ONLY), every(ASSIGNED_ONLY, { contacts: ALL }))).toBe(true);
    expect(sameOnlyAssigned(every(ALL), every(DEPARTMENT))).toBe(true);
  });

  it("is false for on/off, and for two different partial states", () => {
    expect(sameOnlyAssigned(every(ASSIGNED_ONLY), every(ALL))).toBe(false);
    expect(sameOnlyAssigned(every(ALL, { deals: ASSIGNED_ONLY }), every(ALL))).toBe(false);
    expect(sameOnlyAssigned(every(ALL, { deals: ASSIGNED_ONLY }), every(ALL, { messages: ASSIGNED_ONLY }))).toBe(false);
    expect(sameOnlyAssigned(every(ALL, { deals: ASSIGNED_ONLY }), every(ALL, { deals: ASSIGNED_ONLY }))).toBe(true);
  });
});

describe("withOnlyAssigned", () => {
  it("on: makes every one of them assigned-only and leaves every other resource as stored", () => {
    const before = every(DEPARTMENT, { contacts: DEPARTMENT, containers: ALL });
    const after = withOnlyAssigned(before, true);
    expect(after).toEqual(every(ASSIGNED_ONLY, { contacts: DEPARTMENT, containers: ALL }));
    expect(before.deals).toBe(DEPARTMENT); // not mutated
  });

  it("off: opens them to all, and leaves every other resource as stored", () => {
    const after = withOnlyAssigned(every(ASSIGNED_ONLY, { contacts: ASSIGNED_ONLY, containers: ASSIGNED_ONLY }), false);
    expect(after).toEqual(every(ALL, { contacts: ASSIGNED_ONLY, containers: ASSIGNED_ONLY }));
  });

  it("off: gives back what the fallback (the saved role) had where that was not assigned-only", () => {
    const saved = every(ALL, { deals: DEPARTMENT, commission: DEPARTMENT, invoices: ASSIGNED_ONLY });
    const after = withOnlyAssigned(withOnlyAssigned(saved, true), false, saved);
    expect(after).toEqual(every(ALL, { deals: DEPARTMENT, commission: DEPARTMENT }));
  });

  it("off: keeps a department or all already there, and fills a missing one with all", () => {
    const after = withOnlyAssigned({ deals: DEPARTMENT, invoices: ASSIGNED_ONLY }, false);
    expect(after).toEqual(every(ALL, { deals: DEPARTMENT }));
  });
});

describe("newRoleScope — a role made in Add New Role", () => {
  it("starts with all on every resource when there is nothing to copy (a missing scope reads as assigned-only on the server)", () => {
    const scope = newRoleScope();
    expect(Object.keys(scope).sort()).toEqual(Object.keys(RESOURCE_REGISTRY).sort());
    expect(Object.values(scope).every((s) => s === ALL)).toBe(true);
    expect(onlyAssignedOf(scope)).toBe(false);
  });

  it("copies the template role's scope, filling what it lacks with all", () => {
    const scope = newRoleScope({ deals: ASSIGNED_ONLY, containers: ASSIGNED_ONLY });
    expect(scope.deals).toBe(ASSIGNED_ONLY);
    expect(scope.containers).toBe(ASSIGNED_ONLY);
    expect(scope.invoices).toBe(ALL);
    expect(Object.keys(scope).sort()).toEqual(Object.keys(RESOURCE_REGISTRY).sort());
  });
});

/** The seeded roles, on both sides: the Technician sees only their jobs, nobody else does. */
describe("the system roles", () => {
  const server = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.id, r]));

  it.each([
    ["role-technician", true],
    ["role-admin", false],
    ["role-dispatcher", false],
    ["role-dept-manager", false],
    ["role-read-only", false],
    ["role-super-admin", false],
  ] as const)("%s: switch on = %s on the server seed and on the web mirror", (id, on) => {
    expect(onlyAssignedState(server[id].dataScope)).toEqual({ on, partly: [] });
    expect(onlyAssignedState(SYSTEM_ROLES[id].dataScope)).toEqual({ on, partly: [] });
  });
});
