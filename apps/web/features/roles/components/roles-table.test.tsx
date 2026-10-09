import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataScope } from "@bitcrm/types";
import type { Role } from "@bitcrm/types";
import { RolesTable } from "./roles-table";

function role(over: Partial<Role>): Role {
  return {
    id: "role-x",
    name: "Custom",
    permissions: {},
    dataScope: { deals: DataScope.DEPARTMENT },
    dealStageTransitions: [],
    isSystem: false,
    priority: 50,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const roles = [
  role({ id: "role-super-admin", name: "Super Admin", isSystem: true, priority: 100, dataScope: { deals: DataScope.ALL } }),
  role({ id: "role-admin", name: "Admin", description: "Most permissions", isSystem: true, priority: 80, dataScope: { deals: DataScope.ALL } }),
  role({ id: "role-regional", name: "Regional Lead", priority: 50 }),
];

function renderTable(props: Partial<Parameters<typeof RolesTable>[0]> = {}) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onSort = vi.fn();
  render(
    <RolesTable
      roles={roles}
      memberCounts={{ "role-super-admin": 1, "role-admin": 3, "role-regional": 0 }}
      canDelete
      sort={null}
      onSort={onSort}
      onOpen={onOpen}
      onDelete={onDelete}
      {...props}
    />,
  );
  return { onOpen, onDelete, onSort };
}

describe("RolesTable — Workiz's Roles & Permissions grid", () => {
  it("leads with Role and ends with Actions, ours between", () => {
    renderTable();
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(heads).toEqual(["Role", "Type", "Priority", "Default scope", "Members", "Actions"]);
  });

  it("prints each role: its name over its description, type, priority, scope, members", () => {
    renderTable();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Most permissions")).toBeInTheDocument();
    expect(screen.getAllByText("System")).toHaveLength(2);
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText("Department")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("gives a custom role Workiz's yellow “Delete Role”, a system one none", async () => {
    const { onDelete, onOpen } = renderTable();
    const buttons = screen.getAllByRole("button", { name: /delete role/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Delete Role Regional Lead");
    await userEvent.click(buttons[0]);
    expect(onDelete).toHaveBeenCalledWith(roles[2]);
    // The button is not the row: the role does not open.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("no Delete Role without roles.delete", () => {
    renderTable({ canDelete: false });
    expect(screen.queryByRole("button", { name: /delete role/i })).not.toBeInTheDocument();
  });

  it("opens the role when its row is clicked, and sorts from a header", async () => {
    const { onOpen, onSort } = renderTable();
    await userEvent.click(screen.getByText("Regional Lead"));
    expect(onOpen).toHaveBeenCalledWith(roles[2], expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Sort by Members" }));
    expect(onSort).toHaveBeenCalledWith("members");
  });
});
