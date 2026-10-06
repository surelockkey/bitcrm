import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { DataScope } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UsersPage } from "./users-page";
import { UserPermissionsPage } from "./user-permissions-page";

/**
 * Admin → Users and a user's permission overrides appear once, whole.
 *
 * The list said "No access" while the signed-in user was on the way, then
 * drew its rows with a custom role printed as its id until the roles came,
 * over a "2 users" that became the real total when the count did. The
 * overrides page asked for the user, then — once it had them — for their
 * permissions, their role and the schema, and only once it was on screen for
 * every role (whether you outrank them), so the page could still change
 * after it appeared.
 *
 * Now each waits for what it shows and comes in one frame, with nothing left
 * to ask for.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(),
}));

const me = { id: "u-owner", firstName: "Ada", lastName: "Owner", email: "ada@example.com", roleId: "role-super-admin" };

const nightDesk = {
  id: "role-night-desk",
  name: "Night Desk",
  permissions: { deals: { view: true } },
  dataScope: { deals: DataScope.ALL },
  dealStageTransitions: [],
  isSystem: false,
  priority: 40,
  createdAt: "",
  updatedAt: "",
};

const pat = {
  id: "u-pat",
  firstName: "Pat",
  lastName: "Rivers",
  email: "pat@example.com",
  roleId: "role-night-desk",
  status: "active",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UsersPage — loading", () => {
  it("goes from one skeleton to rows with their role names and the total, in one frame", async () => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: 40 },
      { match: /\/users$/, raw: true, reply: () => ({ success: true, data: [me, pat], pagination: {} }), delayMs: 20 },
      { match: /\/users\/count$/, reply: () => ({ total: 131 }), delayMs: 60 },
      // The roles last — the order that printed the role's id.
      { match: /\/users\/roles$/, reply: () => [nightDesk], delayMs: 90 },
    ]);
    const refused = watchFirstFrame(() => !!screen.queryByText("No access"), () => true);
    const rawId = watchFirstFrame(() => !!screen.queryByText("role-night-desk"), () => true);
    const first = watchFirstFrame(
      () => !!screen.queryByText("Pat Rivers"),
      () => ({
        skeletons: skeletonCount(),
        role: !!screen.queryByText("Night Desk"),
        total: !!screen.queryByText("131 users"),
        newUser: !!screen.queryByRole("button", { name: /new user/i }),
      }),
    );

    renderWithClient(
      <TooltipProvider>
        <UsersPage />
      </TooltipProvider>,
    );
    await screen.findByText("Pat Rivers");
    await settle();
    first.stop();
    refused.stop();
    rawId.stop();

    expect(refused.frame()).toBeNull();
    expect(rawId.frame()).toBeNull();
    expect(first.frame()).toEqual({ skeletons: 0, role: true, total: true, newUser: true });
    expect(duplicates(server.requests)).toEqual([]);
  });
});

describe("UserPermissionsPage — loading", () => {
  it("asks for everything it shows before it appears, and appears whole", async () => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: 20 },
      { match: /\/users\/u-pat$/, reply: () => pat, delayMs: 20 },
      {
        match: /\/users\/u-pat\/permissions$/,
        reply: () => ({ ...nightDesk, roleId: nightDesk.id, roleName: nightDesk.name, isSystemRole: false, hasOverrides: false }),
        delayMs: 20,
      },
      { match: /\/users\/roles\/role-night-desk$/, reply: () => nightDesk, delayMs: 20 },
      { match: /\/users\/roles\/schema$/, reply: () => ({ deals: ["view", "edit"] }), delayMs: 20 },
      { match: /\/users\/roles$/, reply: () => [nightDesk], delayMs: 60 },
    ]);
    const refused = watchFirstFrame(() => !!screen.queryByText("No access"), () => true);
    const first = watchFirstFrame(
      () => !!screen.queryByRole("heading", { name: "Pat Rivers" }),
      () => ({ skeletons: skeletonCount(), requestsSoFar: server.requests.length }),
    );

    renderWithClient(<UserPermissionsPage userId="u-pat" />);
    await screen.findByRole("heading", { name: "Pat Rivers" });
    await settle();
    first.stop();
    refused.stop();

    expect(refused.frame()).toBeNull();
    expect(first.frame()?.skeletons).toBe(0);
    // Nothing is asked for once the page is up — it would only change it.
    expect(server.requests.length).toBe(first.frame()?.requestsSoFar);
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});
