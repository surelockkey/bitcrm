import { describe, it, expect } from "vitest";
import {
  HISTORY_LIMIT,
  labelForPath,
  pushVisit,
  type PageVisit,
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
    ["/inventory/products", "Products"],
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
  });

  it("ignores query strings and trailing slashes", () => {
    expect(labelForPath("/deals/")).toBe("Jobs");
  });
});
