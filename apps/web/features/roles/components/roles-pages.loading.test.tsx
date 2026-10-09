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
import { RolesPage } from "./roles-page";
import { RoleEditorPage } from "./role-editor-page";

/**
 * Admin → Roles and a role's editor appear once, whole.
 *
 * The list came up with a grey bar in every Members cell and filled them one
 * request at a time (six roles, six answers, six repaints — the audit counted
 * eighteen skeletons), under a "0 roles" that turned into the real number.
 * The editor opened before it knew who held the role: the "Members" tab grew
 * " · 3" a beat later and pushed "Details" along. Both said "No access" first,
 * while the signed-in user was on the way.
 *
 * Now each waits for what it shows and comes in one frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/roles",
}));

const me = { id: "u-owner", firstName: "Ada", lastName: "Owner", email: "ada@example.com", roleId: "role-super-admin" };

const role = (id: string, name: string, priority: number, isSystem = true) => ({
  id,
  name,
  description: `${name} role`,
  permissions: { deals: { view: true } },
  dataScope: { deals: DataScope.ALL },
  dealStageTransitions: [],
  isSystem,
  priority,
  createdAt: "",
  updatedAt: "",
});

const roles = [
  role("role-super-admin", "Super Admin", 100),
  role("role-dispatcher", "Dispatcher", 60),
  role("role-night-desk", "Night Desk", 40, false),
];

const members: Record<string, number> = { "role-super-admin": 1, "role-dispatcher": 3, "role-night-desk": 2 };
/** Each role's members answer on their own beat, as the browser saw. */
const memberDelay: Record<string, number> = { "role-super-admin": 30, "role-dispatcher": 60, "role-night-desk": 90 };

const person = (n: number) => ({ id: `u-${n}`, firstName: "Pat", lastName: `Number${n}`, email: `p${n}@example.com`, roleId: "x" });

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routes() {
  return [
    { match: /\/users\/me$/, reply: () => me, delayMs: 40 },
    { match: /\/users\/roles$/, reply: () => roles, delayMs: 20 },
    { match: /\/users\/roles\/schema$/, reply: () => ({ deals: ["view", "edit"] }), delayMs: 20 },
    { match: /\/users\/roles\/role-dispatcher$/, reply: () => roles[1], delayMs: 20 },
    ...Object.keys(members).map((id) => ({
      match: new RegExp(`/users/roles/${id}/users$`),
      reply: () => Array.from({ length: members[id] }, (_, i) => person(i)),
      delayMs: memberDelay[id],
    })),
  ];
}

describe("RolesPage — loading", () => {
  it("goes from one skeleton to every role with its member count, in one frame", async () => {
    server = installFakeServer(routes());
    const refused = watchFirstFrame(() => !!screen.queryByText("No access"), () => true);
    const first = watchFirstFrame(
      () => !!screen.queryByText("Night Desk"),
      () => ({
        skeletons: skeletonCount(),
        counts: ["1", "3", "2"].every((n) => screen.queryAllByText(n).length > 0),
        total: !!screen.queryByText("Showing 1 to 3 of 3 results"),
        zero: !!screen.queryByText("Showing 1 to 0 of 0 results"),
        newRole: !!screen.queryByRole("button", { name: "Add New Role" }),
      }),
    );
    const zero = watchFirstFrame(() => !!screen.queryByText("Showing 1 to 0 of 0 results"), () => true);

    renderWithClient(<RolesPage />);
    await screen.findByText("Night Desk");
    await settle();
    first.stop();
    refused.stop();
    zero.stop();

    expect(refused.frame()).toBeNull();
    expect(zero.frame()).toBeNull();
    expect(first.frame()).toEqual({ skeletons: 0, counts: true, total: true, zero: false, newRole: true });
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});

describe("RoleEditorPage — loading", () => {
  it("opens with the member count on its tab and nothing more to ask for", async () => {
    server = installFakeServer(routes());
    const refused = watchFirstFrame(() => !!screen.queryByText("No access"), () => true);
    const first = watchFirstFrame(
      () => !!screen.queryByRole("heading", { name: "Edit permissions for role Dispatcher" }),
      () => ({
        skeletons: skeletonCount(),
        members: screen.queryByRole("tab", { name: /members/i })?.textContent ?? null,
        requestsSoFar: server.requests.length,
      }),
    );

    renderWithClient(<RoleEditorPage roleId="role-dispatcher" />);
    await screen.findByRole("heading", { name: "Edit permissions for role Dispatcher" });
    await settle();
    first.stop();
    refused.stop();

    expect(refused.frame()).toBeNull();
    expect(first.frame()).toEqual(expect.objectContaining({ skeletons: 0, members: "Members 3" }));
    // Everything the editor shows was asked for before it appeared.
    expect(server.requests.length).toBe(first.frame()?.requestsSoFar);
    expect(duplicates(server.requests)).toEqual([]);
  });
});
