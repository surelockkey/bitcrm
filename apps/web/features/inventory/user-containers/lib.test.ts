import { describe, it, expect } from "vitest";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import type { UserContainer } from "@bitcrm/types";
import type { StockLocation } from "@/features/inventory/stock/lib";
import {
  accessLabel,
  assignmentOf,
  containerUserNames,
  nameOf,
  namesSummary,
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
