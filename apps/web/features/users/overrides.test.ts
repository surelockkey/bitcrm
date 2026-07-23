import { describe, it, expect } from "vitest";
import { DataScope } from "@bitcrm/types";
import type { Role } from "@bitcrm/types";
import { normalizeMatrix } from "@/features/roles/lib";
import {
  applyOverrides,
  buildOverrides,
  diffMatrixSparse,
  diffScopesSparse,
  normalizeScopes,
  overrideSummary,
  type OverridesDraft,
} from "./overrides";

const schema = {
  deals: ["view", "create", "edit", "delete"],
  settings: ["view", "edit"],
} as const;

const role = {
  id: "role-x",
  name: "X",
  permissions: { deals: { view: true, edit: true }, settings: { view: true } },
  dataScope: { deals: DataScope.DEPARTMENT },
  dealStageTransitions: ["new_lead->estimate_sent"],
  isSystem: false,
  priority: 40,
} as unknown as Role;

function draftFromRole(): OverridesDraft {
  return {
    permissions: normalizeMatrix(role.permissions, schema),
    dataScope: normalizeScopes(role.dataScope, schema),
    transitionsOverridden: false,
    dealStageTransitions: [...role.dealStageTransitions],
  };
}

describe("diffMatrixSparse", () => {
  it("captures grants and revokes, omits unchanged cells", () => {
    const effective = normalizeMatrix(
      { deals: { view: true, delete: true }, settings: { view: true } },
      schema,
    );
    // vs base: deals.edit revoked, deals.delete granted
    const diff = diffMatrixSparse(effective, role.permissions, schema);
    expect(diff).toEqual({ deals: { edit: false, delete: true } });
  });

  it("returns undefined when nothing differs", () => {
    const effective = normalizeMatrix(role.permissions, schema);
    expect(diffMatrixSparse(effective, role.permissions, schema)).toBeUndefined();
  });
});

describe("diffScopesSparse", () => {
  it("treats a missing scope as All data on both sides", () => {
    // settings missing in role base (= ALL); explicit ALL in draft is no change
    const same = { deals: DataScope.DEPARTMENT, settings: DataScope.ALL };
    expect(diffScopesSparse(same, role.dataScope, schema)).toBeUndefined();

    const changed = { deals: DataScope.ALL, settings: DataScope.ASSIGNED_ONLY };
    expect(diffScopesSparse(changed, role.dataScope, schema)).toEqual({
      deals: DataScope.ALL,
      settings: DataScope.ASSIGNED_ONLY,
    });
  });
});

describe("buildOverrides", () => {
  it("returns null when the draft equals the role everywhere", () => {
    expect(buildOverrides(draftFromRole(), role, schema)).toBeNull();
  });

  it("omits the transitions field when not overridden", () => {
    const draft = draftFromRole();
    draft.permissions = { ...draft.permissions, deals: { ...draft.permissions.deals, delete: true } };
    const o = buildOverrides(draft, role, schema);
    expect(o).toEqual({ permissions: { deals: { delete: true } } });
    expect(o).not.toHaveProperty("dealStageTransitions");
  });

  it("sends the full transitions list when overridden, even if identical", () => {
    const draft = draftFromRole();
    draft.transitionsOverridden = true;
    const o = buildOverrides(draft, role, schema);
    expect(o).toEqual({ dealStageTransitions: ["new_lead->estimate_sent"] });
  });
});

describe("round-trip", () => {
  it("applying the built override onto the base reproduces the draft", () => {
    const draft = draftFromRole();
    draft.permissions = normalizeMatrix(
      { deals: { create: true, delete: true }, settings: {} },
      schema,
    );
    const o = buildOverrides(draft, role, schema)!;
    const merged = normalizeMatrix(applyOverrides(role.permissions, o.permissions), schema);
    expect(merged).toEqual(draft.permissions);
  });
});

describe("overrideSummary", () => {
  it("handles absent and empty override objects", () => {
    expect(overrideSummary(undefined).any).toBe(false);
    expect(overrideSummary({}).any).toBe(false);
  });

  it("counts cells and flags transitions", () => {
    const s = overrideSummary({
      permissions: { deals: { edit: false, delete: true }, settings: { edit: true } },
      dataScope: { deals: DataScope.ALL },
      dealStageTransitions: [],
    });
    expect(s).toEqual({
      permissionCells: 3,
      scopeCells: 1,
      transitionsOverridden: true,
      any: true,
    });
  });
});
