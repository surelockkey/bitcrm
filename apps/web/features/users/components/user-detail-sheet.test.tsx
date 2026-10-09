import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserStatus, type Role, type User } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import { UserDetailSheet } from "./user-detail-sheet";

const mutations = vi.hoisted(() => ({ update: vi.fn(), assign: vi.fn(), resend: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn() }));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
const roles = [
  { id: "role-dispatcher", name: "Dispatcher", priority: 40 },
  { id: "role-technician", name: "Technician", priority: 20 },
] as Role[];
vi.mock("../use-can-manage", () => ({
  useHierarchy: () => ({
    roles,
    canManage: () => true,
    canEditProfile: () => true,
    assignableRoles: (r: Role[]) => r,
  }),
}));
vi.mock("../hooks", () => ({
  useUpdateUser: () => ({ mutate: mutations.update, isPending: false }),
  useAssignRole: () => ({ mutate: mutations.assign, isPending: false }),
  useResendInvite: () => ({ mutate: mutations.resend }),
  useDeactivateUser: () => ({ mutate: mutations.deactivate }),
  useReactivateUser: () => ({ mutate: mutations.reactivate }),
  useSetUserMfa: () => ({ mutate: vi.fn(), isPending: false }),
}));

const tech: User = {
  id: "u1",
  cognitoSub: "s1",
  email: "alex@b.com",
  firstName: "Alex",
  lastName: "Bell",
  roleId: "role-technician",
  department: "Field",
  status: UserStatus.ACTIVE,
  createdAt: "2026-04-03T00:00:00Z",
  updatedAt: "2026-04-03T00:00:00Z",
};

/** The user's card in Workiz's words: Actions ⌄, User Details, Field team member, Roles and permissions. */
describe("UserDetailSheet", () => {
  it("opens on Profile: User Details in outlined boxes, the technician on the field team", () => {
    renderWithClient(<UserDetailSheet user={tech} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "User Details" })).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("Alex");
    expect(screen.getByRole("checkbox", { name: "Field team member" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Two-step sign-in" })).toBeInTheDocument();
  });

  it("keeps the account's actions under Workiz's Actions ⌄", async () => {
    renderWithClient(<UserDetailSheet user={tech} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /actions/i }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Resend invite", "Deactivate"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Resend invite" }));
    expect(mutations.resend).toHaveBeenCalledWith("u1");
  });

  it("Role & access: Workiz's Roles and permissions — the Role box and the way to this person's permissions", async () => {
    renderWithClient(<UserDetailSheet user={tech} defaultTab="role" onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Roles and permissions" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update role" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Customize roles and permissions here" })).toHaveAttribute(
      "href",
      "/admin/users/u1/permissions",
    );
  });
});
