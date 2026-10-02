import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

const user = (id: string, firstName: string, lastName: string): User =>
  ({
    id, cognitoSub: id, email: `${id}@b.com`, firstName, lastName, roleId: "role-csr", department: "Office",
    status: UserStatus.ACTIVE, createdAt: "2026-04-03T00:00:00Z", updatedAt: "2026-04-03T00:00:00Z",
  }) as User;

describe("UsersPage — search", () => {
  it("asks the server, so a user from the second page is found too", async () => {
    const searched: string[] = [];
    server.use(
      http.get("*/users/roles", () => HttpResponse.json({ success: true, data: [{ id: "role-csr", name: "CSR", priority: 50 }] })),
      http.get("*/users/count", ({ request }) => {
        const search = new URL(request.url).searchParams.get("search");
        return HttpResponse.json({ success: true, data: { total: search ? 1 : 60, atLeast: false } });
      }),
      http.get("*/users", ({ request }) => {
        const search = new URL(request.url).searchParams.get("search");
        if (search) searched.push(search);
        const data = search ? [user("u60", "Eve", "Brown")] : [user("u1", "Anna", "Smith"), user("u2", "Bob", "Jones")];
        return HttpResponse.json({ success: true, data, pagination: { count: data.length, nextCursor: search ? undefined : "p2" } });
      }),
    );
    renderWithClient(<UsersPage />);
    expect(await screen.findByText("Anna Smith")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search name, email, department"), "brown");
    expect(await screen.findByText("Eve Brown")).toBeInTheDocument();
    expect(screen.queryByText("Anna Smith")).not.toBeInTheDocument();
    // Debounced: one request for the word, not one per keystroke.
    await waitFor(() => expect(searched).toEqual(["brown"]));
    expect(screen.getByText("1 user")).toBeInTheDocument();
  });
});
