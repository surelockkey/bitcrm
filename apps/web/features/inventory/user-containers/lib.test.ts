import { describe, it, expect } from "vitest";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import type { UserContainer } from "@bitcrm/types";
import type { StockLocation } from "@/features/inventory/stock/lib";
import {
  accessLabel,
  assignmentBody,
  locationChoice,
  locationChoices,
  assignmentOf,
  containerUserNames,
  nameOf,
  namesSummary,
  usersOfContainer,
} from "./lib";

const row = (over: Partial<UserContainer>): UserContainer => ({
  userId: "u1",
  userName: "Taras Koval",
  access: UserContainerAccess.CONTAINER,
  containerId: "c1",
  containerName: "Van 1",
  limited: false,
  updatedAt: "2026-09-30T10:00:00.000Z",
  ...over,
});

const van = (over: Partial<StockLocation>): StockLocation => ({
  type: "container",
  id: "c1",
  name: "Van 1",
  status: InventoryStatus.ACTIVE,
  ...over,
});

describe("accessLabel", () => {
  it("names the three Workiz choices, and a user never assigned", () => {
    expect(accessLabel(UserContainerAccess.CONTAINER)).toBe("Container");
    expect(accessLabel(UserContainerAccess.ALL)).toBe("All locations");
    expect(accessLabel(UserContainerAccess.NONE)).toBe("No access");
    expect(accessLabel(null)).toBe("Not set");
  });
});

describe("nameOf", () => {
  const directory = new Map([["u2", "Pavlo Bondar"]]);

  it("keeps the name the row carries", () => {
    expect(nameOf(row({}), directory)).toBe("Taras Koval");
  });

  // The import backfill wrote the user id as the name for secondary users.
  it("looks a person up when the row's name is only their id", () => {
    expect(nameOf(row({ userId: "u2", userName: "u2" }), directory)).toBe("Pavlo Bondar");
  });

  it("never prints an id it can't resolve", () => {
    expect(nameOf(row({ userId: "u9", userName: "u9" }), directory)).toBeUndefined();
  });
});

describe("assignmentOf", () => {
  const rows = new Map([
    ["u1", row({})],
    ["u3", row({ userId: "u3", access: UserContainerAccess.NONE, containerId: undefined, containerName: undefined })],
  ]);
  const vans = [van({}), van({ id: "c2", name: "Van 2", technicianId: "u2" }), van({ id: "c3", name: "Van 3", technicianId: "u3" })];

  it("reads the user's row", () => {
    expect(assignmentOf("u1", rows, vans)).toMatchObject({
      access: UserContainerAccess.CONTAINER,
      containerId: "c1",
      containerName: "Van 1",
      legacy: false,
    });
  });

  // A user without a row still works from the van that names them as its
  // technician — the server resolves them the same way.
  it("falls back to the van that names the user as its technician", () => {
    expect(assignmentOf("u2", rows, vans)).toEqual({
      access: UserContainerAccess.CONTAINER,
      containerId: "c2",
      containerName: "Van 2",
      limited: false,
      legacy: true,
    });
  });

  it("lets a row win over the legacy link", () => {
    expect(assignmentOf("u3", rows, vans)).toMatchObject({ access: UserContainerAccess.NONE, legacy: false });
  });

  it("says Not set for someone with neither", () => {
    expect(assignmentOf("u9", rows, vans)).toEqual({ access: null, limited: false, legacy: false });
  });

  it("names the container from the fleet when it has been renamed since", () => {
    const renamed = [van({ name: "Van One" })];
    expect(assignmentOf("u1", rows, renamed).containerName).toBe("Van One");
  });
});

describe("containerUserNames", () => {
  it("groups the users of each container by name", () => {
    const rows = [
      row({ userId: "u1", userName: "Taras Koval", containerId: "c1" }),
      row({ userId: "u2", userName: "u2", containerId: "c1" }),
      row({ userId: "u3", userName: "Olha", containerId: "c2" }),
      row({ userId: "u4", userName: "Nobody", access: UserContainerAccess.ALL, containerId: undefined }),
    ];
    const byVan = containerUserNames(rows, new Map([["u2", "Pavlo Bondar"]]));
    expect(byVan.get("c1")).toEqual([
      { userId: "u2", name: "Pavlo Bondar" },
      { userId: "u1", name: "Taras Koval" },
    ]);
    expect(byVan.get("c2")).toEqual([{ userId: "u3", name: "Olha" }]);
    expect(byVan.has("undefined")).toBe(false);
  });

  it("holds an unresolved id back rather than print it", () => {
    const byVan = containerUserNames([row({ userId: "u2", userName: "u2" })], new Map());
    expect(byVan.get("c1")).toEqual([{ userId: "u2", name: undefined }]);
  });
});

describe("namesSummary", () => {
  it("shows the first two and counts the rest", () => {
    expect(namesSummary(["Ann", "Bob"])).toEqual({ text: "Ann, Bob", more: 0 });
    expect(namesSummary(["Ann", "Bob", "Cid", "Dan"])).toEqual({ text: "Ann, Bob", more: 2 });
    expect(namesSummary([])).toEqual({ text: "", more: 0 });
  });
});

describe("usersOfContainer", () => {
  const rows = [
    row({ userId: "u1", userName: "Taras Koval", containerId: "c1" }),
    row({ userId: "u5", userName: "Olha", access: UserContainerAccess.ALL, containerId: undefined }),
  ];
  const byUser = new Map(rows.map((r) => [r.userId, r] as const));
  const byVan = containerUserNames(rows, new Map());

  it("is the users whose row names the van", () => {
    expect(usersOfContainer(van({ id: "c1", technicianId: "u9", technicianName: "Old Tech" }), byVan, byUser)).toEqual([
      { userId: "u1", name: "Taras Koval" },
    ]);
  });

  // No row points at the van: its technician still works from it — unless a
  // row of their own sends them elsewhere.
  it("falls back to the van's legacy technician when no row points at it", () => {
    expect(usersOfContainer(van({ id: "c2", technicianId: "u2", technicianName: "Pavlo" }), byVan, byUser)).toEqual([
      { userId: "u2", name: "Pavlo", legacy: true },
    ]);
    expect(usersOfContainer(van({ id: "c2", technicianId: "u5", technicianName: "Olha" }), byVan, byUser)).toEqual([]);
    expect(usersOfContainer(van({ id: "c3" }), byVan, byUser)).toEqual([]);
  });
});

/**
 * Workiz's User locations row (pg_inventory_wz_02_user-locations): one
 * "Location" box — All, a location, or (BitCRM's word for Workiz's "NO
 * ACCESS" location) No access — and the "Restricted" switch beside it.
 */
describe("locationChoices", () => {
  it("offers All, No access, then every active van by name", () => {
    expect(
      locationChoices([
        van({ id: "c2", name: "Van 2" }),
        van({ id: "w1", type: "warehouse", name: "Main" }),
        van({ id: "c1", name: "Van 1" }),
        van({ id: "c9", name: "Old van", status: InventoryStatus.ARCHIVED }),
      ]),
    ).toEqual([
      { value: "all", label: "All" },
      { value: "none", label: "No access" },
      { value: "container:c1", label: "Van 1" },
      { value: "container:c2", label: "Van 2" },
    ]);
  });
});

describe("locationChoice", () => {
  it("is the box's value for an assignment", () => {
    expect(locationChoice({ access: UserContainerAccess.ALL })).toBe("all");
    expect(locationChoice({ access: UserContainerAccess.NONE })).toBe("none");
    expect(
      locationChoice({ access: UserContainerAccess.CONTAINER, containerId: "c1" }),
    ).toBe("container:c1");
    // Never assigned: the box shows its placeholder.
    expect(locationChoice({ access: null })).toBe("");
  });
});

describe("assignmentBody", () => {
  it("saves a van with the Restricted switch, the user's name kept on the row", () => {
    expect(assignmentBody("container:c1", true, "Ann Lee")).toEqual({
      userName: "Ann Lee",
      access: UserContainerAccess.CONTAINER,
      containerId: "c1",
      limited: true,
    });
  });

  it("saves All and No access without a van or a restriction", () => {
    expect(assignmentBody("all", true, "Ann Lee")).toEqual({ userName: "Ann Lee", access: UserContainerAccess.ALL });
    expect(assignmentBody("none", false, "Ann Lee")).toEqual({ userName: "Ann Lee", access: UserContainerAccess.NONE });
  });
});
