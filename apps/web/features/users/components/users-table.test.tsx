import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Role, User } from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import { UsersTable } from "./users-table";

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../use-can-manage", () => ({
  useHierarchy: () => ({ canManage: () => true }),
}));
vi.mock("../hooks", () => ({
  useResendInvite: () => ({ mutate: vi.fn() }),
  useDeactivateUser: () => ({ mutate: vi.fn() }),
  useReactivateUser: () => ({ mutate: vi.fn() }),
}));

const roles = [{ id: "role-dispatcher", name: "Dispatcher", priority: 40 }] as Role[];
const users: User[] = [
  {
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
  },
];

describe("UsersTable", () => {
  it("renders a row with name, email, role, and status", () => {
    render(<UsersTable users={users} roles={roles} onOpen={() => {}} />);
    expect(screen.getByText("Alex Bell")).toBeInTheDocument();
    expect(screen.getByText("alex@b.com")).toBeInTheDocument();
    expect(screen.getByText("Dispatcher")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("opens the user when the row is clicked", async () => {
    const onOpen = vi.fn();
    render(<UsersTable users={users} roles={roles} onOpen={onOpen} />);
    await userEvent.click(screen.getByText("Alex Bell"));
    expect(onOpen).toHaveBeenCalledWith(users[0]);
  });

  it("marks users that have permission overrides with a custom badge", () => {
    const overridden: User[] = [
      { ...users[0], permissionOverrides: { permissions: { deals: { delete: true } } } },
    ];
    render(<UsersTable users={overridden} roles={roles} onOpen={() => {}} />);
    expect(screen.getByText("custom")).toBeInTheDocument();
  });

  it("shows no custom badge without overrides", () => {
    render(<UsersTable users={users} roles={roles} onOpen={() => {}} />);
    expect(screen.queryByText("custom")).not.toBeInTheDocument();
  });
});

/**
 * Стабільний перший кадр: ширини оголошені й тягнуться, нічого не міряється
 * по вмісту.
 */
describe("UsersTable — a stable first frame", () => {
  const render1 = () => render(<UsersTable users={users} roles={roles} onOpen={() => {}} />);

  it("lays the columns out at declared widths, not by content", () => {
    const { container } = render1();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const { container } = render1();
    const cols = [...container.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  it("lets no body cell set a width of its own", () => {
    const { container } = render1();
    for (const td of [...container.querySelectorAll("tbody td")]) {
      for (const cls of td.className.split(/\s+/)) {
        expect(cls).not.toMatch(/^(min-w-|max-w-|w-)/);
      }
      expect((td as HTMLElement).style.width).toBe("");
    }
  });

  it("puts a resize handle on every header", () => {
    render1();
    for (const id of ["user", "role", "department", "status", "added", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
