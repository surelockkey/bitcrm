import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Role, User } from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import { userRows } from "../users-list";
import { UsersTable } from "./users-table";

const perms = vi.hoisted(() => ({ all: true }));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => perms.all }),
}));
vi.mock("../use-can-manage", () => ({
  useHierarchy: () => ({ canManage: () => true }),
}));
const mutations = vi.hoisted(() => ({ resend: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn() }));
vi.mock("../hooks", () => ({
  useResendInvite: () => ({ mutate: mutations.resend }),
  useDeactivateUser: () => ({ mutate: mutations.deactivate }),
  useReactivateUser: () => ({ mutate: mutations.reactivate }),
}));

const roles = [{ id: "role-dispatcher", name: "Dispatcher", priority: 40 }] as Role[];
const alex: User = {
  id: "u1",
  cognitoSub: "s1",
  email: "alex@b.com",
  firstName: "Alex",
  lastName: "Bell",
  phone: "+15055550100",
  roleId: "role-dispatcher",
  department: "Phoenix",
  status: UserStatus.ACTIVE,
  createdAt: "2022-11-04T15:16:00.000Z",
  updatedAt: "2022-11-04T15:16:00.000Z",
};

function renderTable(users: User[], props: Partial<Parameters<typeof UsersTable>[0]> = {}) {
  const onOpen = vi.fn();
  const onSort = vi.fn();
  render(
    <UsersTable
      rows={userRows(users, roles)}
      sort={{ column: "name", dir: "asc" }}
      onSort={onSort}
      onOpen={onOpen}
      {...props}
    />,
  );
  return { onOpen, onSort };
}

describe("UsersTable — Workiz's Team grid", () => {
  it("has the Team page's columns, then ours", () => {
    renderTable([alex]);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(heads).toEqual(["Name", "Phone", "Role", "Field team", "Department", "Created", "Actions"]);
  });

  it("prints a row as Workiz does: name over email, blue phone, yes/no, the Created stamp", () => {
    renderTable([alex]);
    expect(screen.getByText("Alex Bell")).toBeInTheDocument();
    expect(screen.getByText("alex@b.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "(505) 555-0100" })).toHaveAttribute("href", "tel:+15055550100");
    expect(screen.getByText("Dispatcher")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
    expect(screen.getByText("Phoenix")).toBeInTheDocument();
    // Workiz's "Fri Nov 04, 2022 07:16 am", on the business's clock.
    expect(screen.getByText(/^Fri Nov 04, 2022 \d\d:16 (am|pm)$/)).toBeInTheDocument();
  });

  it("chips under the email: 2FA, Inactive, and ours — Custom permissions", () => {
    renderTable([
      {
        ...alex,
        smsMfaEnabled: true,
        status: UserStatus.INACTIVE,
        permissionOverrides: { permissions: { deals: { delete: true } } },
      },
    ]);
    expect(screen.getByText("2FA")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Custom permissions")).toBeInTheDocument();
  });

  it("no chips for a plain active account", () => {
    renderTable([alex]);
    expect(screen.queryByText("2FA")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom permissions")).not.toBeInTheDocument();
  });

  it("opens the user when the row is clicked, and sorts from a header", async () => {
    const { onOpen, onSort } = renderTable([alex]);
    await userEvent.click(screen.getByText("Alex Bell"));
    expect(onOpen).toHaveBeenCalledWith(alex, "profile", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Sort by Role" }));
    expect(onSort).toHaveBeenCalledWith("role");
  });

  it("keeps the row's own actions behind its ••• — opening the menu opens no user", async () => {
    const { onOpen } = renderTable([alex]);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Alex Bell" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual([
      "View",
      "Edit profile",
      "Change role",
      "Resend invite",
      "Deactivate",
    ]);
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Change role" }));
    expect(onOpen).toHaveBeenCalledWith(alex, "role");
  });

  it("offers Reactivate for a switched-off user", async () => {
    renderTable([{ ...alex, status: UserStatus.INACTIVE }]);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Alex Bell" }));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Reactivate" }));
    expect(mutations.reactivate).toHaveBeenCalledWith("u1");
  });
});
