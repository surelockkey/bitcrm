import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataScope } from "@bitcrm/types";
import type { Role } from "@bitcrm/types";
import { RolesTable } from "./roles-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

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
  role({ id: "role-admin", name: "Admin", isSystem: true, priority: 80, dataScope: { deals: DataScope.ALL } }),
  role({ id: "role-regional", name: "Regional Lead", priority: 50 }),
];

describe("RolesTable", () => {
  it("renders each role with type, priority, scope and member count", () => {
    render(<RolesTable roles={roles} memberCounts={{ "role-admin": 3, "role-regional": 1 }} />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Regional Lead")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText("All data")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("orders rows by priority, highest first", () => {
    render(<RolesTable roles={roles} memberCounts={{}} />);
    const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(names[0]).toContain("Admin");
    expect(names[1]).toContain("Regional Lead");
  });

  it("navigates to the editor when a row is clicked", async () => {
    render(<RolesTable roles={roles} memberCounts={{}} />);
    await userEvent.click(screen.getByText("Regional Lead"));
    expect(push).toHaveBeenCalledWith("/admin/roles/role-regional");
  });
});
