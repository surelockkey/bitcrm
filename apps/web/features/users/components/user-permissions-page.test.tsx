import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ResolvedPermissions, Role, User } from "@bitcrm/types";
import { DataScope, UserStatus } from "@bitcrm/types";
import { UserPermissionsPage } from "./user-permissions-page";

const state = vi.hoisted(() => ({
  canEditUsers: true,
  canManage: true,
  isSelf: false,
}));

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (_r: string, a: string) => (a === "view" ? true : state.canEditUsers),
  }),
}));
vi.mock("../use-can-manage", () => ({
  useHierarchy: () => ({
    canManage: () => state.canManage,
    isSelf: () => state.isSelf,
  }),
}));

const schema = { deals: ["view", "create", "edit", "delete"] };

const role = {
  id: "role-dispatcher",
  name: "Dispatcher",
  permissions: { deals: { view: true } },
  dataScope: { deals: DataScope.ASSIGNED_ONLY },
  dealStageTransitions: [],
  isSystem: true,
  priority: 40,
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
} as unknown as Role;

const user: User = {
  id: "u1",
  cognitoSub: "s1",
  email: "alex@b.com",
  firstName: "Alex",
  lastName: "Bell",
  roleId: "role-dispatcher",
  department: "Phoenix",
  status: UserStatus.ACTIVE,
  createdAt: "2026-04-03T00:00:00Z",
  updatedAt: "2026-04-03T00:00:00Z",
};

const resolved: ResolvedPermissions = {
  roleId: "role-dispatcher",
  roleName: "Dispatcher",
  isSystemRole: true,
  permissions: { deals: { view: true } },
  dataScope: { deals: DataScope.ASSIGNED_ONLY },
  dealStageTransitions: [],
  hasOverrides: false,
};

vi.mock("../hooks", () => ({
  useUser: () => ({ data: user, isLoading: false, isError: false }),
  useUserPermissions: () => ({
    data: resolved,
    isLoading: false,
    isError: false,
    dataUpdatedAt: 1,
  }),
  useSetUserPermissions: () => ({ mutate: vi.fn(), isPending: false }),
  useClearUserPermissions: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/roles/hooks", () => ({
  useRole: () => ({ data: role, isLoading: false, isError: false }),
  useRoleSchema: () => ({ data: schema }),
}));

describe("UserPermissionsPage access gating", () => {
  beforeEach(() => {
    state.canEditUsers = true;
    state.canManage = true;
    state.isSelf = false;
  });

  it("lets an authorized manager edit and shows the dirty bar after a change", async () => {
    render(<UserPermissionsPage userId="u1" />);
    expect(
      screen.getByText(/Changes apply on top of the “Dispatcher” role/),
    ).toBeInTheDocument();

    const switches = screen.getAllByRole("switch");
    expect(switches.some((s) => !(s as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: "Deals Delete" }));
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    expect(screen.getByText(/1 cell overridden \(1 granted, 0 revoked\)/)).toBeInTheDocument();
  });

  it("is read-only with an explanatory banner when the target is yourself", () => {
    state.isSelf = true;
    state.canManage = false;
    render(<UserPermissionsPage userId="u1" />);
    expect(
      screen.getByText("You can't change your own permission overrides."),
    ).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches.every((s) => (s as HTMLButtonElement).disabled)).toBe(true);
  });

  it("is read-only for callers without users.edit", () => {
    state.canEditUsers = false;
    render(<UserPermissionsPage userId="u1" />);
    expect(screen.getByText("You have view-only access to users.")).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    expect(switches.every((s) => (s as HTMLButtonElement).disabled)).toBe(true);
  });
});
