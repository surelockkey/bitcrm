import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import {
  chooseFilter,
  clearFilters,
  filterChips,
  filterGroups,
  removeFilterChip,
  type FilterCatalogs,
} from "./job-filters";
import { EMPTY_JOBS_LIST_STATE, type JobsListCaps, type JobsListState } from "./query-params";

const base: JobsListState = { ...EMPTY_JOBS_LIST_STATE };
const single: JobsListCaps = { multiValue: false, unpaid: false, textSearch: false };
const multi: JobsListCaps = { multiValue: true, unpaid: false, textSearch: false };

const catalogs: FilterCatalogs = {
  techs: [
    { id: "t1", name: "(2) TX - David Szender" },
    { id: "t2", name: "(2) TX - Matthew Salinas" },
  ],
  tags: [
    { id: "g1", name: "Needs a call", color: "blue" },
    { id: "g2", name: "cx texted STOP", color: "red" },
    { id: "g3", name: "pending texted", color: "violet" },
  ],
  jobTypes: [
    { id: "jt1", name: "Car lockout" },
    { id: "jt2", name: "Service" },
  ],
  areas: [{ name: "Platinum_AL" }, { name: "North Carolina" }],
  companies: [
    { id: "bp1", name: "SureLock" },
    { id: "bp2", name: "KeyPro" },
  ],
};

const titles = (groups: ReturnType<typeof filterGroups>) => groups.map((g) => g.title);
const labels = (groups: ReturnType<typeof filterGroups>, title: string) =>
  groups.find((g) => g.title === title)?.options.map((o) => o.label);

describe("filterGroups — the columns of the Filter results menu", () => {
  it("lists Workiz's groups first, then ours, each with its catalog", () => {
    const groups = filterGroups(catalogs, base, "");
    expect(titles(groups)).toEqual(["Techs", "Tags", "Job type", "Service Areas", "Status", "Company", "Sort"]);
    expect(labels(groups, "Techs")).toEqual(["(2) TX - David Szender", "(2) TX - Matthew Salinas"]);
    expect(labels(groups, "Status")).toEqual(["Done", "Canceled"]);
  });

  it("offers Company only when there is more than one", () => {
    const groups = filterGroups({ ...catalogs, companies: [{ id: "bp1", name: "SureLock" }] }, base, "");
    expect(titles(groups)).not.toContain("Company");
  });

  it("typing narrows every group by substring, case-insensitively, and hides the empty ones", () => {
    // Workiz: "tex" → only TAGS, with "cx texted STOP" and "pending texted".
    const groups = filterGroups(catalogs, base, "tex");
    expect(titles(groups)).toEqual(["Tags"]);
    expect(labels(groups, "Tags")).toEqual(["cx texted STOP", "pending texted"]);
  });

  it("a chosen option leaves the menu", () => {
    const state = { ...base, techIds: ["t1"], tagIds: ["g1"], tab: JobSuperStatus.DONE };
    const groups = filterGroups(catalogs, state, "");
    expect(labels(groups, "Techs")).toEqual(["(2) TX - Matthew Salinas"]);
    expect(labels(groups, "Tags")).toEqual(["cx texted STOP", "pending texted"]);
    expect(labels(groups, "Status")).toEqual(["Canceled"]);
  });

  it("the sort group offers the orders other than the one in force", () => {
    expect(labels(filterGroups(catalogs, base, ""), "Sort")).toEqual([
      "Latest day first",
      "Earliest hour first",
      "Latest hour first",
    ]);
    expect(labels(filterGroups(catalogs, { ...base, sort: "hour_asc" }, ""), "Sort")).toEqual([
      "Latest day first",
      "Latest hour first",
    ]);
  });
});

describe("chooseFilter — picking an option", () => {
  it("adds a tech, a tag, a job type, an area and a company to their own lists", () => {
    let s = base;
    s = chooseFilter(s, { group: "tech", value: "t1", label: "x" }, single);
    s = chooseFilter(s, { group: "tag", value: "g1", label: "x" }, single);
    s = chooseFilter(s, { group: "type", value: "jt2", label: "x" }, single);
    s = chooseFilter(s, { group: "area", value: "Platinum_AL", label: "x" }, single);
    s = chooseFilter(s, { group: "company", value: "bp2", label: "x" }, single);
    expect(s).toMatchObject({
      techIds: ["t1"],
      tagIds: ["g1"],
      jobTypeIds: ["jt2"],
      serviceAreas: ["Platinum_AL"],
      businessProfileIds: ["bp2"],
    });
  });

  it("while the server takes one value per group, a second pick replaces the first", () => {
    let s = chooseFilter(base, { group: "tech", value: "t1", label: "x" }, single);
    s = chooseFilter(s, { group: "tech", value: "t2", label: "x" }, single);
    expect(s.techIds).toEqual(["t2"]);
  });

  it("once it takes several, picks add up (OR inside the group, like Workiz)", () => {
    let s = chooseFilter(base, { group: "tech", value: "t1", label: "x" }, multi);
    s = chooseFilter(s, { group: "tech", value: "t2", label: "x" }, multi);
    s = chooseFilter(s, { group: "tech", value: "t2", label: "x" }, multi);
    expect(s.techIds).toEqual(["t1", "t2"]);
  });

  it("a status opens that status in place of the tab", () => {
    expect(chooseFilter(base, { group: "status", value: "done", label: "Done" }, single).tab).toBe(JobSuperStatus.DONE);
  });

  it("a sort sets the order", () => {
    expect(chooseFilter(base, { group: "sort", value: "hour_desc", label: "x" }, single).sort).toBe("hour_desc");
  });

  it("leaves the search text alone", () => {
    expect(chooseFilter({ ...base, search: "Dustin" }, { group: "tech", value: "t1", label: "x" }, single).search).toBe(
      "Dustin",
    );
  });
});

describe("filterChips — what the control shows once something is chosen", () => {
  it("labels each chip the Workiz way, kind first", () => {
    const state: JobsListState = {
      ...base,
      techIds: ["t1"],
      tagIds: ["g1"],
      jobTypeIds: ["jt1"],
      serviceAreas: ["Platinum_AL"],
      businessProfileIds: ["bp2"],
      tab: JobSuperStatus.CANCELED,
      sort: "day_desc",
    };
    expect(filterChips(state, catalogs).map((c) => c.label)).toEqual([
      "user: (2) TX - David Szender",
      "tag: Needs a call",
      "type: Car lockout",
      "metro: Platinum_AL",
      "status: Canceled",
      "company: KeyPro",
      "sort: Latest day first",
    ]);
  });

  it("an open tab is a tab, not a chip", () => {
    expect(filterChips({ ...base, tab: "unscheduled" }, catalogs)).toEqual([]);
    expect(filterChips(base, catalogs)).toEqual([]);
  });

  it("the day window and the hours read as one chip each", () => {
    const one = filterChips({ ...base, dateFrom: "2026-10-08" }, catalogs).map((c) => c.label);
    expect(one).toEqual(["scheduled: Oct 8"]);
    const range = filterChips({ ...base, dateFrom: "2026-10-08", dateTo: "2026-10-12" }, catalogs).map((c) => c.label);
    expect(range).toEqual(["scheduled: Oct 8 – Oct 12"]);
    expect(filterChips({ ...base, hourFrom: "08:00", hourTo: "12:00" }, catalogs).map((c) => c.label)).toEqual([
      "hours: 08:00 – 12:00",
    ]);
    expect(filterChips({ ...base, hourFrom: "08:00" }, catalogs).map((c) => c.label)).toEqual(["hours: from 08:00"]);
    expect(filterChips({ ...base, hourTo: "12:00" }, catalogs).map((c) => c.label)).toEqual(["hours: until 12:00"]);
  });

  it("a value the catalog no longer has still shows, by its id", () => {
    expect(filterChips({ ...base, techIds: ["gone"] }, catalogs).map((c) => c.label)).toEqual(["user: gone"]);
  });
});

describe("removing chips", () => {
  const full: JobsListState = {
    ...base,
    search: "Dustin",
    techIds: ["t1", "t2"],
    tagIds: ["g1"],
    tab: JobSuperStatus.DONE,
    dateFrom: "2026-10-08",
    dateTo: "2026-10-09",
    hourFrom: "08:00",
    sort: "hour_asc",
    unpaid: true,
  };

  it("a chip's × takes exactly that value off", () => {
    const chips = filterChips(full, catalogs);
    const t1 = chips.find((c) => c.label === "user: (2) TX - David Szender")!;
    expect(removeFilterChip(full, t1).techIds).toEqual(["t2"]);
    const status = chips.find((c) => c.kind === "status")!;
    expect(removeFilterChip(full, status).tab).toBe(JobSuperStatus.SUBMITTED);
    const scheduled = chips.find((c) => c.kind === "scheduled")!;
    expect(removeFilterChip(full, scheduled)).toMatchObject({ dateFrom: undefined, dateTo: undefined });
    const hours = chips.find((c) => c.kind === "hours")!;
    expect(removeFilterChip(full, hours)).toMatchObject({ hourFrom: undefined, hourTo: undefined });
    const sort = chips.find((c) => c.kind === "sort")!;
    expect(removeFilterChip(full, sort).sort).toBe("none");
  });

  it("clear-all empties the control but keeps the search text and Show unpaid jobs", () => {
    const cleared = clearFilters(full);
    expect(filterChips(cleared, catalogs)).toEqual([]);
    expect(cleared).toMatchObject({
      tab: JobSuperStatus.SUBMITTED,
      search: "Dustin",
      unpaid: true,
      techIds: [],
      tagIds: [],
      sort: "none",
    });
  });

  it("clear-all keeps an open tab where it was", () => {
    expect(clearFilters({ ...base, tab: JobSuperStatus.PENDING, techIds: ["t1"] }).tab).toBe(JobSuperStatus.PENDING);
  });
});
