import { describe, it, expect } from "vitest";
import {
  HISTORY_LIMIT,
  applyLabel,
  applyVisit,
  isRedirectHop,
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
    // Workiz's own crumb on its Home page reads "DASHBOARD", and on Workiz
    // Phone "CALLS" — the sidebar words differ, the crumbs copy Workiz's.
    ["/", "Dashboard"],
    ["/calls", "Calls"],
    ["/messages", "Messages"],
    ["/deals", "Jobs"],
    ["/dispatch", "Map"],
    ["/schedule", "Schedule"],
    ["/contacts", "Clients"],
    ["/companies", "Companies"],
    ["/estimates", "Estimates"],
    ["/invoices", "Invoices"],
    ["/work-orders", "Work Orders"],
    ["/price-book", "Price book"],
    ["/reports", "Reports"],
    ["/automations", "Automations"],
    ["/inventory", "Inventory"],
    // Team lives under Settings now (as in Workiz) but keeps its own crumbs.
    ["/technicians", "Technicians"],
    ["/admin/users", "Users"],
    ["/admin/roles", "Roles"],
    ["/settings", "Settings"],
    ["/my-jobs", "My Jobs"],
    ["/my-stock", "My Stock"],
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
    ["/my-jobs/abc-123", "Job"],
    // Workiz's breadcrumb on a client page: "… # DASHBOARD # CLIENT".
    ["/contacts/c1", "Client"],
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
    expect(labelForPath("/inventory/warehouses")).toBe("Warehouses");
  });

  it("titles the Inventory tabs as Workiz's breadcrumb does (… # INVENTORY # USER LOCATIONS)", () => {
    expect(labelForPath("/inventory/items")).toBe("Inventory");
    expect(labelForPath("/inventory/user-containers")).toBe("User locations");
  });

  it("titles the Price book tabs as the Price book, not as Inventory's Items", () => {
    expect(labelForPath("/price-book/items")).toBe("Price book");
    expect(labelForPath("/price-book/categories")).toBe("Price book Categories");
    expect(labelForPath("/price-book/brands")).toBe("Price book Brands");
  });

  it("titles the Phone section's tabs as Workiz's breadcrumb does, not as a call", () => {
    expect(labelForPath("/calls/numbers")).toBe("Numbers");
    expect(labelForPath("/calls/flows")).toBe("Call Flows");
    expect(labelForPath("/calls/groups")).toBe("Call groups");
    expect(labelForPath("/calls/texting")).toBe("Text Messages");
  });

  it("titles the call flow builder as Workiz does (\"CALL FLOW BUILDER\"), new or saved", () => {
    expect(labelForPath("/calls/flows/new")).toBe("Call Flow Builder");
    expect(labelForPath("/calls/flows/3f1c9a2e-5b7d-4c1e-9f0a-2b3c4d5e6f70")).toBe("Call Flow Builder");
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
    // Workiz: "… # ESTIMATE (1)" on an estimate, "INVOICE (…)" on an invoice —
    // the page fills in the number; the list's plural never stands in.
    [`/estimates/${UUID}`, "Estimate"],
    [`/invoices/${UUID}`, "Invoice"],
  ])("labels the detail route %s as %s", (path, label) => {
    expect(labelForPath(path)).toBe(label);
  });

  it("never renders a raw id, even for unknown detail routes", () => {
    expect(labelForPath(`/widgets/${UUID}`)).toBe("Widgets");
    expect(labelForPath("/widgets/123456789")).toBe("Widgets");
  });
});

/**
 * Workiz's strip holds one crumb per page. A route that only hands the reader
 * on — `/payments` → `/reports/payments`, `/price-book` → `/price-book/items`,
 * `/inventory` → `/inventory/items`, `/settings/general` → `/settings` — used
 * to leave its own crumb behind ("PAYMENTS # PAYMENTS", "SETTINGS # GENERAL #
 * SETTINGS"); now it leaves none.
 */
describe("redirect hops leave no crumb", () => {
  const empty: TrailState = { visits: [], labels: {} };

  it.each([
    "/payments",
    "/price-book",
    "/inventory",
    "/inventory/items/new",
    "/settings/general",
    "/settings/automations",
    "/settings/call-flows",
    "/settings/call-groups",
    "/settings/messaging",
    "/settings/message-templates",
    "/settings/phone-numbers",
    "/inventory/warehouses/0199c4d2-7b1e-4f7a-9c3d-abcdef123456",
    "/inventory/containers/0199c4d2-7b1e-4f7a-9c3d-abcdef123456",
    "/inventory/products/0199c4d2-7b1e-4f7a-9c3d-abcdef123456",
    "/inventory/items/0199c4d2-7b1e-4f7a-9c3d-abcdef123456",
  ])("knows %s only redirects", (path) => {
    expect(isRedirectHop(path)).toBe(true);
    expect(isRedirectHop(path + "/")).toBe(true);
  });

  it.each(["/", "/deals", "/reports/payments", "/price-book/items", "/inventory/items", "/settings", "/inventory/warehouses"])(
    "treats %s as a page of its own",
    (path) => {
      expect(isRedirectHop(path)).toBe(false);
    },
  );

  it("records the page a hop lands on, never the hop", () => {
    let s = applyVisit(empty, "/deals");
    s = applyVisit(s, "/payments");
    s = applyVisit(s, "/reports/payments");
    expect(s.visits.map((v) => v.label)).toEqual(["Jobs", "Payments"]);

    s = applyVisit(s, "/settings");
    s = applyVisit(s, "/settings/general");
    s = applyVisit(s, "/settings");
    expect(s.visits.map((v) => v.label)).toEqual(["Jobs", "Payments", "Settings"]);
  });

  it("keeps one crumb when a page re-lands under the same name", () => {
    // "/calls" then "/calls/": one page, one crumb, at its newest path.
    let s = applyVisit(empty, "/deals");
    s = applyVisit(s, "/calls");
    s = applyVisit(s, "/calls/");
    expect(s.visits).toEqual([
      { path: "/deals", label: "Jobs" },
      { path: "/calls/", label: "Calls" },
    ]);
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
