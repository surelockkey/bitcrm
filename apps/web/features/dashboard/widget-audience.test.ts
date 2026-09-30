import { describe, expect, it } from "vitest";
import type { Role } from "@bitcrm/types";
import { audienceRows, changedRoles, grantPatch, roleSees } from "./widget-audience";

const role = (over: Partial<Role> & { name: string; id: string }): Role =>
  ({
    description: "",
    permissions: {},
    dataScope: {},
    dealStageTransitions: [],
    isSystem: true,
    priority: 0,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Role;

const admin = role({
  id: "r-admin",
  name: "Admin",
  priority: 90,
  permissions: { dashboard: { view: true, view_jobs_by_status: true } } as never,
});
const tech = role({
  id: "r-tech",
  name: "Technician",
  priority: 20,
  permissions: { dashboard: { view: false, view_jobs_by_status: false } } as never,
});
const dispatcher = role({ id: "r-disp", name: "Dispatcher", priority: 40 });
const superAdmin = role({ id: "r-su", name: "Super Admin", priority: 100 });

/**
 * «Хто бачить віджет» читається з тієї самої матриці прав, що її перевіряє
 * сервер. Тому діалог не має власного сховища — він просто показує гранти.
 */
describe("roleSees", () => {
  it("reads the widget's own action", () => {
    expect(roleSees(admin, "view_jobs_by_status")).toBe(true);
    expect(roleSees(tech, "view_jobs_by_status")).toBe(false);
  });

  it("treats an unset grant as denied", () => {
    expect(roleSees(dispatcher, "view_jobs_by_status")).toBe(false);
  });

  // Super Admin обходить матрицю в самому гуарді — показувати його вимкненим
  // означало б збрехати про те, що він побачить.
  it("always says yes for Super Admin, whatever the matrix holds", () => {
    expect(roleSees(superAdmin, "view_jobs_by_status")).toBe(true);
  });
});

describe("audienceRows", () => {
  const rows = audienceRows([tech, admin, superAdmin, dispatcher], "view_jobs_by_status");

  it("puts the most powerful role first", () => {
    expect(rows.map((r) => r.name)).toEqual(["Super Admin", "Admin", "Dispatcher", "Technician"]);
  });

  it("locks the row that cannot be changed", () => {
    expect(rows[0]).toMatchObject({ name: "Super Admin", sees: true, locked: true });
    expect(rows[1]).toMatchObject({ name: "Admin", sees: true, locked: false });
  });
});

describe("grantPatch", () => {
  it("flips one action and keeps the rest of the dashboard block", () => {
    const patch = grantPatch(admin, "view_jobs_by_status", false);
    expect(patch.dashboard).toEqual({ view: true, view_jobs_by_status: false });
  });

  // PUT замінює матрицю цілком: надіслати саму секцію dashboard означало б
  // стерти всі інші права ролі.
  it("sends the whole matrix back, not just the widget's block", () => {
    const withMore = role({
      id: "r-x",
      name: "Admin",
      permissions: { deals: { view: true }, dashboard: { view: true } } as never,
    });
    const patch = grantPatch(withMore, "view_jobs_by_status", true);
    expect(patch.deals).toEqual({ view: true });
  });

  it("creates the block for a role that never had one", () => {
    expect(grantPatch(dispatcher, "view_jobs_by_status", true).dashboard).toEqual({
      view_jobs_by_status: true,
    });
  });
});

describe("changedRoles", () => {
  const roles = [superAdmin, admin, dispatcher, tech];

  it("returns only the roles whose answer actually moved", () => {
    const next = { "r-admin": true, "r-disp": true, "r-tech": false };
    expect(changedRoles(roles, "view_jobs_by_status", next).map((r) => r.id)).toEqual(["r-disp"]);
  });

  it("never writes Super Admin, whose grant the guard ignores", () => {
    const next = { "r-su": false };
    expect(changedRoles(roles, "view_jobs_by_status", next)).toEqual([]);
  });

  it("nothing to save when nothing was touched", () => {
    expect(changedRoles(roles, "view_jobs_by_status", {})).toEqual([]);
  });
});
