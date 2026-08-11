import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { User } from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import { UserPermissionsSummary } from "./user-permissions-summary";

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

describe("UserPermissionsSummary", () => {
  it("shows inheritance text and the editor link when there are no overrides", () => {
    render(
      <UserPermissionsSummary
        user={user}
        roleLabel="Dispatcher"
        canEdit
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText("Inherits all permissions from the Dispatcher role."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Manage permissions" });
    expect(link).toHaveAttribute("href", "/admin/users/u1/permissions");
  });

  it("summarizes stored overrides and shows the Custom badge", () => {
    const overridden: User = {
      ...user,
      permissionOverrides: {
        permissions: { deals: { delete: true, edit: false }, reports: { view: true } },
        dataScope: { deals: "all" as never },
        dealStageTransitions: ["*->*"],
      },
    };
    render(
      <UserPermissionsSummary
        user={overridden}
        roleLabel="Dispatcher"
        canEdit
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(
      screen.getByText(
        "On top of the Dispatcher role: 3 permission overrides · 1 data scope override · custom stage transitions.",
      ),
    ).toBeInTheDocument();
  });

  it("labels the link View permissions for read-only callers", () => {
    render(
      <UserPermissionsSummary
        user={user}
        roleLabel="Dispatcher"
        canEdit={false}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: "View permissions" })).toBeInTheDocument();
  });

  it("closes the sheet when the link is clicked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const onClose = vi.fn();
    render(
      <UserPermissionsSummary user={user} roleLabel="Dispatcher" canEdit onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("link", { name: "Manage permissions" }));
    expect(onClose).toHaveBeenCalled();
  });
});
