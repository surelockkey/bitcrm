import { describe, expect, it } from "vitest";
import type { TechnicianProfile, User } from "@bitcrm/types";
import {
  DEFAULT_TEAM_FILTER,
  filterTeam,
  formatTeamCreated,
  teamFilterGroups,
  teamRows,
  type TeamRow,
} from "./team-list";

function profile(over: Partial<TechnicianProfile> = {}): TechnicianProfile {
  return {
    userId: "u1",
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: "active",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

function user(over: Partial<User> = {}): User {
  return {
    id: "u1",
    cognitoSub: "s",
    email: "riley@slk.com",
    firstName: "Riley",
    lastName: "Santos",
    roleId: "role-tech",
    department: "Field",
    status: "active" as User["status"],
    createdAt: "2026-09-16T12:41:00.000Z",
    updatedAt: "2026-09-16T12:41:00.000Z",
    ...over,
  };
}

const ctx = (users: User[], extra: Partial<Parameters<typeof teamRows>[1]> = {}) => ({
  users: new Map(users.map((u) => [u.id, u] as const)),
  roles: [
    { id: "role-tech", name: "tech" },
    { id: "role-dispatch", name: "dispatch" },
  ],
  approved: {
    jobTypes: [
      { userId: "u1", jobTypeId: "jt-glass", status: "approved" as const },
      { userId: "u1", jobTypeId: "jt-rekey", status: "approved" as const },
      { userId: "u2", jobTypeId: "jt-rekey", status: "approved" as const },
    ],
    serviceAreas: [
      { userId: "u1", serviceAreaId: "sa-ct", status: "approved" as const },
      { userId: "u1", serviceAreaId: "sa-ny", status: "approved" as const },
    ],
  },
  jobTypeName: (id: string) => ({ "jt-glass": "(A-1) Door Glass Job", "jt-rekey": "Rekey lock" })[id] ?? id,
  areaName: (id: string) => ({ "sa-ct": "SURE LOCK CT", "sa-ny": "SURE LOCK NY" })[id] ?? id,
  ...extra,
});

describe("formatTeamCreated — Workiz's Created column", () => {
  it("prints 'Fri Nov 04, 2022 07:16 am' in the business's zone", () => {
    // 11:16 UTC on Nov 4 2022 is 07:16 in New York (EDT).
    expect(formatTeamCreated("2022-11-04T11:16:00.000Z")).toBe("Fri Nov 04, 2022 07:16 am");
    expect(formatTeamCreated("2026-02-12T18:29:00.000Z")).toBe("Thu Feb 12, 2026 01:29 pm");
  });

  it("prints nothing for nothing", () => {
    expect(formatTeamCreated(undefined)).toBe("");
    expect(formatTeamCreated("not a date")).toBe("");
  });
});

describe("teamRows — one row per technician, as the Team list reads them", () => {
  it("joins the person, the role's name, the flags and their approved skills and areas", () => {
    const [row] = teamRows([profile({ technicianType: "subcontractor", callMaskingEnabled: true })], ctx([
      user({ phone: "+14045551234", smsMfaEnabled: true, fieldTeamMember: false }),
    ]));
    expect(row).toMatchObject({
      id: "u1",
      name: "Riley Santos",
      email: "riley@slk.com",
      phone: "+14045551234",
      twoFactor: true,
      callMasking: true,
      roleId: "role-tech",
      role: "tech",
      fieldTeam: false,
      type: "subcontractor",
      status: "active",
      createdAt: "2026-09-16T12:41:00.000Z",
      skills: ["(A-1) Door Glass Job", "Rekey lock"],
      areaIds: ["sa-ct", "sa-ny"],
      areas: ["SURE LOCK CT", "SURE LOCK NY"],
    });
  });

  it("names an imported person the way Workiz does", () => {
    const [row] = teamRows([profile()], ctx([user({ workizName: "(2) TX - Daniel Munoz" })]));
    expect(row.name).toBe("(2) TX - Daniel Munoz");
  });

  it("reads the field-team flag through the role when the record predates it", () => {
    const [row] = teamRows([profile()], ctx([user({ roleId: "00000000-0000-0000-0000-000000000004" })]));
    expect(typeof row.fieldTeam).toBe("boolean");
  });

  it("leaves a role it cannot name blank, and a profile without a person named as unknown", () => {
    const rows = teamRows([profile(), profile({ userId: "ghost" })], ctx([user({ roleId: "role-x" })], { roles: [] }));
    expect(rows[0].role).toBe("");
    expect(rows[1]).toMatchObject({ id: "ghost", name: "Unknown technician", email: undefined });
  });

  it("counts a regular technician as Workiz's 'User' type", () => {
    const [row] = teamRows([profile()], ctx([user()]));
    expect(row.type).toBe("regular");
  });
});

describe("teamFilterGroups — Workiz's Filter results columns", () => {
  it("lays out status (no heading), Role, User type and Service area", () => {
    const groups = teamFilterGroups({
      roles: [{ id: "role-tech", name: "tech" }],
      areas: [{ id: "sa-ct", name: "SURE LOCK CT" }],
    });
    expect(groups.map((g) => [g.id, g.title, g.chipPrefix])).toEqual([
      ["status", "", "status"],
      ["role", "Role", "role"],
      ["type", "User type", "type"],
      ["area", "Service area", "area"],
    ]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Active", "Pending", "Inactive", "All"]);
    expect(groups[0].chipTone).toBe("white");
    expect(groups[2].options).toEqual([
      { value: "regular", label: "User" },
      { value: "subcontractor", label: "Subcontractor" },
    ]);
  });

  it("drops a group with nothing to offer", () => {
    const groups = teamFilterGroups({ roles: [], areas: [] });
    expect(groups.map((g) => g.id)).toEqual(["status", "type"]);
  });

  it("opens on 'status: Active', as Workiz's Team does", () => {
    expect(DEFAULT_TEAM_FILTER).toEqual([{ group: "status", value: "active" }]);
  });
});

describe("filterTeam", () => {
  const row = (over: Partial<TeamRow>): TeamRow => ({
    id: "x",
    name: "X",
    twoFactor: false,
    callMasking: false,
    role: "",
    fieldTeam: true,
    type: "regular",
    status: "active",
    skills: [],
    areaIds: [],
    areas: [],
    ...over,
  });
  const rows = [
    row({ id: "a", status: "active", roleId: "r1", type: "regular", areaIds: ["ct"] }),
    row({ id: "p", status: "pending", roleId: "r2", type: "subcontractor", areaIds: ["ny"] }),
    row({ id: "i", status: "inactive", roleId: "r1", type: "regular", areaIds: [] }),
  ];
  const ids = (picks: Parameters<typeof filterTeam>[1]) => filterTeam(rows, picks).map((r) => r.id);

  it("keeps everyone with nothing picked, or with status: All", () => {
    expect(ids([])).toEqual(["a", "p", "i"]);
    expect(ids([{ group: "status", value: "all" }])).toEqual(["a", "p", "i"]);
  });

  it("reads Active as Workiz does — not switched off — so a new technician still awaiting setup shows", () => {
    expect(ids([{ group: "status", value: "active" }])).toEqual(["a", "p"]);
    expect(ids([{ group: "status", value: "pending" }])).toEqual(["p"]);
    expect(ids([{ group: "status", value: "inactive" }])).toEqual(["i"]);
  });

  it("ORs the picks of one column and ANDs the columns", () => {
    expect(ids([{ group: "role", value: "r1" }])).toEqual(["a", "i"]);
    expect(ids([{ group: "role", value: "r1" }, { group: "role", value: "r2" }])).toEqual(["a", "p", "i"]);
    expect(ids([{ group: "role", value: "r1" }, { group: "status", value: "active" }])).toEqual(["a"]);
    expect(ids([{ group: "type", value: "subcontractor" }])).toEqual(["p"]);
    expect(ids([{ group: "area", value: "ct" }, { group: "area", value: "ny" }])).toEqual(["a", "p"]);
  });
});
