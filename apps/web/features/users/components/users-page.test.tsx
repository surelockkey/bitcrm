import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { UserStatus, type User } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../use-can-manage", () => ({
  useHierarchy: () => ({ canManage: () => true, canEditProfile: () => true, isSelf: () => false, assignableRoles: () => [], roles: [] }),
}));

import { UsersPage } from "./users-page";

const user = (id: string, firstName: string, lastName: string, over: Partial<User> = {}): User =>
  ({
    id, cognitoSub: id, email: `${id}@b.com`, firstName, lastName, roleId: "role-csr", department: "Office",
    status: UserStatus.ACTIVE, createdAt: "2026-04-03T00:00:00Z", updatedAt: "2026-04-03T00:00:00Z", ...over,
  }) as User;

/** The directory in two pages, as `GET /users` hands it out 100 at a time. */
function directory() {
  server.use(
    http.get("*/users/roles", () => HttpResponse.json({ success: true, data: [{ id: "role-csr", name: "CSR", priority: 50 }] })),
    http.get("*/users", ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      const data = cursor
        ? [user("u60", "Eve", "Brown"), user("u61", "Old", "Timer", { status: UserStatus.INACTIVE })]
        : [user("u1", "Anna", "Smith"), user("u2", "Bob", "Jones")];
      return HttpResponse.json({ success: true, data, pagination: { count: data.length, nextCursor: cursor ? undefined : "p2" } });
    }),
  );
}

describe("UsersPage — the Team list's sibling", () => {
  it("reads the whole directory, so Search finds someone from the second page", async () => {
    directory();
    renderWithClient(<UsersPage />);
    expect(await screen.findByText("Anna Smith")).toBeInTheDocument();
    expect(screen.getByText("Eve Brown")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "brown");
    expect(screen.getByText("Eve Brown")).toBeInTheDocument();
    expect(screen.queryByText("Anna Smith")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 1 of 1 results")).toBeInTheDocument();
  });

  it("opens on status: Active, as Workiz's Team does — the switched-off wait for All", async () => {
    directory();
    renderWithClient(<UsersPage />);
    expect(await screen.findByText("Anna Smith")).toBeInTheDocument();
    expect(screen.getByText("status: Active")).toBeInTheDocument();
    expect(screen.queryByText("Old Timer")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 3 of 3 results")).toBeInTheDocument();
  });

  it("“+ Add New” opens the invite form", async () => {
    directory();
    renderWithClient(<UsersPage />);
    await screen.findByText("Anna Smith");
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Add team member")).toBeInTheDocument();
  });
});
