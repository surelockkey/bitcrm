import { describe, expect, it } from "vitest";
import { UserStatus, type Role, type User } from "@bitcrm/types";
import {
  DEFAULT_USER_FILTER,
  filterUsers,
  searchUsers,
  userFilterGroups,
  userRows,
  type UserRow,
} from "./users-list";

/**
 * The Users list as a sibling of the Team list (pg_technicians, Workiz
 * `/root/team`): every account in one grid — Name (with the email and a 2FA
 * chip), Phone, Role, Field team, Department, Created — under "Filter
 * results" opening on "status: Active".
 */

const user = (over: Partial<User> & { id: string }): User => ({
  cognitoSub: over.id,
  email: `${over.id}@example.com`,
  firstName: "Pat",
  lastName: "Rivers",
  roleId: "role-dispatcher",
  department: "Dispatch",
  status: UserStatus.ACTIVE,
  createdAt: "2026-01-02T15:00:00.000Z",
  updatedAt: "2026-01-02T15:00:00.000Z",
  ...over,
});

const roles = [
  { id: "role-dispatcher", name: "Dispatcher" },
  { id: "role-night-desk", name: "Night Desk" },
] as Role[];

describe("userRows", () => {
  it("reads each account as the grid prints it", () => {
    const [row] = userRows(
      [
        user({
          id: "u1",
          workizName: "(2) TX - Pat Rivers",
          phone: "+15055550100",
          smsMfaEnabled: true,
          permissionOverrides: { permissions: { deals: { delete: true } } },
        }),
      ],
      roles,
    );
    expect(row).toMatchObject({
      id: "u1",
      name: "(2) TX - Pat Rivers",
      email: "u1@example.com",
      phone: "+15055550100",
      twoFactor: true,
      role: "Dispatcher",
      roleId: "role-dispatcher",
      department: "Dispatch",
      status: "active",
      custom: true,
      createdAt: "2026-01-02T15:00:00.000Z",
    });
  });

  it("puts a technician on the field team until switched off, anyone else when switched on", () => {
    const rows = userRows(
      [
        user({ id: "tech", roleId: "role-technician" }),
        user({ id: "off", roleId: "role-technician", fieldTeamMember: false }),
        user({ id: "owner", roleId: "role-dispatcher", fieldTeamMember: true }),
        user({ id: "desk", roleId: "role-dispatcher" }),
      ],
      roles,
    );
    expect(rows.map((r) => [r.id, r.fieldTeam])).toEqual([
      ["tech", true],
      ["off", false],
      ["owner", true],
      ["desk", false],
    ]);
  });

  it("names a role the list of roles lacks by the built-in name, else by its id", () => {
    const rows = userRows([user({ id: "a", roleId: "role-technician" }), user({ id: "b", roleId: "role-x" })], roles);
    expect(rows.map((r) => r.role)).toEqual(["Technician", "role-x"]);
  });

  it("marks an account without overrides as not custom", () => {
    expect(userRows([user({ id: "u" })], roles)[0].custom).toBe(false);
  });
});

describe("Filter results", () => {
  const rows: UserRow[] = userRows(
    [
      user({ id: "a", roleId: "role-dispatcher", department: "Dispatch" }),
      user({ id: "b", roleId: "role-night-desk", department: "Office", status: UserStatus.INACTIVE }),
      user({ id: "c", roleId: "role-night-desk", department: "Office", fieldTeamMember: true }),
    ],
    roles,
  );

  it("opens on status: Active, as Workiz's Team does", () => {
    expect(DEFAULT_USER_FILTER).toEqual([{ group: "status", value: "active" }]);
    expect(filterUsers(rows, DEFAULT_USER_FILTER).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("All takes everyone; Inactive the switched-off", () => {
    expect(filterUsers(rows, [{ group: "status", value: "all" }]).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterUsers(rows, [{ group: "status", value: "inactive" }]).map((r) => r.id)).toEqual(["b"]);
  });

  it("any pick within a column, every column at once", () => {
    const picks = [
      { group: "role", value: "role-night-desk" },
      { group: "role", value: "role-dispatcher" },
      { group: "field", value: "yes" },
    ];
    expect(filterUsers(rows, picks).map((r) => r.id)).toEqual(["c"]);
    expect(filterUsers(rows, [{ group: "department", value: "Office" }]).map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterUsers(rows, [{ group: "field", value: "no" }]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("offers status, Role, Field team and Department — the last two only with something to offer", () => {
    const groups = userFilterGroups({ roles, departments: ["Office", "Dispatch", "Office", ""] });
    expect(groups.map((g) => [g.id, g.title])).toEqual([
      ["status", ""],
      ["role", "Role"],
      ["field", "Field team"],
      ["department", "Department"],
    ]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Active", "Inactive", "All"]);
    expect(groups[2].options.map((o) => o.label)).toEqual(["yes", "no"]);
    // Each department once, in order, blanks left out.
    expect(groups[3].options.map((o) => o.value)).toEqual(["Dispatch", "Office"]);
    expect(userFilterGroups({ roles: [], departments: [] }).map((g) => g.id)).toEqual(["status", "field"]);
  });
});

describe("Search", () => {
  const rows = userRows(
    [
      user({ id: "a", firstName: "Anna", lastName: "Smith", department: "Office", phone: "+1 (505) 555-0100" }),
      user({ id: "b", firstName: "Eve", lastName: "Brown", email: "eve@shop.com" }),
    ],
    roles,
  );

  it("needs every word somewhere in the name, email, department or phone, any case", () => {
    expect(searchUsers(rows, "anna office").map((r) => r.id)).toEqual(["a"]);
    expect(searchUsers(rows, "SHOP.com").map((r) => r.id)).toEqual(["b"]);
    expect(searchUsers(rows, "anna brown")).toEqual([]);
  });

  it("finds a phone by its digits, however it is typed", () => {
    expect(searchUsers(rows, "5550100").map((r) => r.id)).toEqual(["a"]);
    expect(searchUsers(rows, "(505) 555").map((r) => r.id)).toEqual(["a"]);
  });

  it("a blank search keeps everyone", () => {
    expect(searchUsers(rows, "  ")).toHaveLength(2);
  });
});
