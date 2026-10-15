import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataScope, RESOURCE_REGISTRY, type Role } from "@bitcrm/types";
import { DEFAULT_ROLES } from "../../../../../backend/services/user/src/roles/constants/default-roles";
import { ONLY_ASSIGNED_RESOURCES } from "../only-assigned";
import { RoleEditorPage } from "./role-editor-page";

const state = vi.hoisted(() => ({ roleId: "role-technician", editable: true }));
const mutate = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ isLoading: false, can: () => true }),
}));
vi.mock("../use-role-access", () => ({
  useRoleAccess: () => ({
    canViewRoles: true,
    editabilityOf: () => ({ locked: false, aboveMe: false, editable: state.editable, deletable: false }),
  }),
}));

const roles = DEFAULT_ROLES.map((r) => ({ ...r, createdAt: "", updatedAt: "2026-10-01T00:00:00Z" })) as Role[];
const byId = (id: string) => roles.find((r) => r.id === id)!;
const settledQuery = <T,>(data: T) => ({ data, isError: false, isPending: false, fetchStatus: "idle" as const });

vi.mock("../hooks", () => ({
  useRole: () => settledQuery(byId(state.roleId)),
  useRoles: () => settledQuery(roles),
  useRoleSchema: () => settledQuery(RESOURCE_REGISTRY),
  useRoleMembers: () => settledQuery([]),
  useUpdateRole: () => ({ mutate, isPending: false }),
}));

const NAME = "Sees only jobs assigned to them";

/**
 * The role editor after the owner's call of 2026-10-10: the Advanced tab
 * (Data scope + Job stages) is gone; what it did that mattered is one switch
 * at the top of the Actions tab's jobs block.
 */
describe("RoleEditorPage — no Advanced tab, one switch", () => {
  beforeEach(() => {
    state.roleId = "role-technician";
    state.editable = true;
    mutate.mockReset();
  });

  it("has Actions / Reports and ours (Members, Details) — no Advanced", () => {
    render(<RoleEditorPage roleId="role-technician" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Actions", "Reports", "Members 0", "Details"]);
    expect(screen.queryByText("Please choose rules")).not.toBeInTheDocument();
  });

  it("puts the switch at the top of the jobs block, before View Jobs", () => {
    render(<RoleEditorPage roleId="role-technician" />);
    const titles = screen.getAllByRole("heading", { level: 5 }).map((h) => h.textContent);
    expect(titles.slice(0, 2)).toEqual([NAME, "Jobs"]);
  });

  it.each([
    ["role-technician", true],
    ["role-admin", false],
    ["role-dispatcher", false],
  ])("%s: the switch is on = %s", (id, on) => {
    state.roleId = id;
    render(<RoleEditorPage roleId={id} />);
    const sw = screen.getByRole("switch", { name: NAME });
    if (on) expect(sw).toBeChecked();
    else expect(sw).not.toBeChecked();
  });

  it("saves the role's scope with only the job-bound resources changed, and sends no stage moves", async () => {
    state.roleId = "role-dispatcher";
    render(<RoleEditorPage roleId="role-dispatcher" />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(screen.getByRole("switch", { name: NAME }));
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const body = mutate.mock.calls[0][0].body;
    const saved = byId("role-dispatcher").dataScope;
    for (const r of Object.keys(saved)) {
      const expected = (ONLY_ASSIGNED_RESOURCES as readonly string[]).includes(r) ? DataScope.ASSIGNED_ONLY : saved[r];
      expect(body.dataScope[r], r).toBe(expected);
    }
    expect(body).not.toHaveProperty("dealStageTransitions");
  });

  it("on then off again is no change (the Dispatcher's department comes back)", async () => {
    state.roleId = "role-dispatcher";
    render(<RoleEditorPage roleId="role-dispatcher" />);
    await userEvent.click(screen.getByRole("switch", { name: NAME }));
    await userEvent.click(screen.getByRole("switch", { name: NAME }));
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("is greyed when the role is read-only", () => {
    state.editable = false;
    render(<RoleEditorPage roleId="role-technician" />);
    expect(screen.getByRole("switch", { name: NAME })).toBeDisabled();
  });
});
