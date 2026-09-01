import { describe, it, expect } from "vitest";
import {
  HISTORY_LIMIT,
  applyLabel,
  applyVisit,
  labelForPath,
  pushVisit,
  type PageVisit,
  type TrailState,
} from "./page-history";

const v = (path: string, label = path): PageVisit => ({ path, label });

describe("pushVisit", () => {
  it("appends a new visit at the end", () => {
    const next = pushVisit([v("/deals", "Jobs")], v("/contacts", "Contacts"));
    expect(next).toEqual([v("/deals", "Jobs"), v("/contacts", "Contacts")]);
  });

  it("does not duplicate a re-visit of the current page", () => {
    const next = pushVisit([v("/deals", "Jobs")], v("/deals", "Jobs"));
    expect(next).toEqual([v("/deals", "Jobs")]);
  });

  it("moves a previously visited path to the end", () => {
    const next = pushVisit(
      [v("/settings"), v("/deals"), v("/contacts")],
      v("/deals"),
    );
    expect(next.map((e) => e.path)).toEqual([
      "/settings",
      "/contacts",
      "/deals",
    ]);
  });

  it("updates the label when the path is already in history", () => {
    const next = pushVisit(
      [v("/settings"), v("/deals/d1", "Job")],
      v("/deals/d1", "Job (3QI2BN)"),
    );
    expect(next).toEqual([v("/settings"), v("/deals/d1", "Job (3QI2BN)")]);
  });

  it(`keeps only the last ${HISTORY_LIMIT} visits, dropping the oldest`, () => {
    let history: PageVisit[] = [];
    for (const p of ["/a", "/b", "/c", "/d", "/e", "/f", "/g"]) {
      history = pushVisit(history, v(p));
    }
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history.map((e) => e.path)).toEqual([
      "/b",
      "/c",
      "/d",
      "/e",
      "/f",
      "/g",
    ]);
  });

  it("does not mutate the input array", () => {
    const history = [v("/deals")];
    pushVisit(history, v("/contacts"));
    expect(history).toEqual([v("/deals")]);
  });
});

describe("labelForPath", () => {
  it.each([
    ["/", "Dashboard"],
    ["/deals", "Jobs"],
    ["/dispatch", "Dispatch Map"],
    ["/schedule", "Schedule"],
    ["/contacts", "Contacts"],
    ["/companies", "Companies"],
    ["/inventory", "Inventory"],
    ["/technicians", "Technicians"],
    ["/admin/users", "Users"],
    ["/admin/roles", "Roles"],
    ["/work-orders", "Work Orders"],
    ["/settings", "Settings"],
  ])("labels the nav route %s as %s", (path, label) => {
    expect(labelForPath(path)).toBe(label);
  });

  it.each([
    ["/settings/general", "General"],
    ["/settings/job-types", "Job Types"],
    ["/settings/job-statuses", "Job Statuses"],
    ["/settings/service-areas", "Service Areas"],
  ])("labels the settings page %s as %s", (path, label) => {
    expect(labelForPath(path)).toBe(label);
  });

  it.each([
    ["/deals/new", "New Job"],
    ["/deals/abc-123", "Job"],
    ["/contacts/c1", "Contact"],
    ["/companies/co1", "Company"],
    ["/technicians/t9", "Technician"],
    ["/profile", "My Profile"],
  ])("labels the dynamic route %s as %s", (path, label) => {
    expect(labelForPath(path)).toBe(label);
  });

  it("falls back to a humanized last segment for unknown paths", () => {
    expect(labelForPath("/reports/commission")).toBe("Commission");
    expect(labelForPath("/some-new-page")).toBe("Some New Page");
    // Inventory tab routes label themselves off their last segment.
    expect(labelForPath("/inventory/items")).toBe("Items");
    expect(labelForPath("/inventory/warehouses")).toBe("Warehouses");
  });

  it("ignores query strings and trailing slashes", () => {
    expect(labelForPath("/deals/")).toBe("Jobs");
  });

  const UUID = "0199c4d2-7b1e-4f7a-9c3d-abcdef123456";

  it.each([
    [`/calls/CA3f0e9c2b1d4a5e6f7a8b9c0d1e2f3a4b`, "Call"],
    [`/admin/roles/${UUID}`, "Role"],
    [`/admin/users/${UUID}`, "User"],
    [`/inventory/containers/${UUID}`, "Container"],
    [`/inventory/warehouses/${UUID}`, "Warehouse"],
    [`/inventory/items/${UUID}`, "Item"],
  ])("labels the detail route %s as %s", (path, label) => {
    expect(labelForPath(path)).toBe(label);
  });

  it("never renders a raw id, even for unknown detail routes", () => {
    expect(labelForPath(`/widgets/${UUID}`)).toBe("Widgets");
    expect(labelForPath("/widgets/123456789")).toBe("Widgets");
  });
});

describe("trail state (visits + upgraded labels)", () => {
  const UUID = "0199c4d2-7b1e-4f7a-9c3d-abcdef123456";
  const empty: TrailState = { visits: [], labels: {} };

  it("keeps an upgraded label when the page is visited again", () => {
    let s = applyVisit(empty, `/deals/${UUID}`);
    s = applyLabel(s, `/deals/${UUID}`, "Job (KWLA6P)");
    s = applyVisit(s, "/deals");
    s = applyVisit(s, `/deals/${UUID}`);
    expect(s.visits.at(-1)).toEqual({
      path: `/deals/${UUID}`,
      label: "Job (KWLA6P)",
    });
  });

  it("applies a label registered before the visit is recorded", () => {
    // Effect order on a revisit with cached data: the page's setLabel fires
    // before the trail records the navigation.
    let s = applyLabel(empty, `/deals/${UUID}`, "Job (KWLA6P)");
    s = applyVisit(s, `/deals/${UUID}`);
    expect(s.visits.at(-1)).toEqual({
      path: `/deals/${UUID}`,
      label: "Job (KWLA6P)",
    });
  });

  it("drops a stored label once its page falls off the trail", () => {
    let s = applyVisit(empty, `/deals/${UUID}`);
    s = applyLabel(s, `/deals/${UUID}`, "Job (KWLA6P)");
    for (let i = 0; i < 6; i++) s = applyVisit(s, `/page-${i}`);
    expect(s.visits.some((p) => p.path === `/deals/${UUID}`)).toBe(false);
    expect(s.labels[`/deals/${UUID}`]).toBeUndefined();
  });
});
