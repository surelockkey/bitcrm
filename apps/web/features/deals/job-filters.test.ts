import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import {
  chooseFilter,
  clearFilters,
  filterAreas,
  filterChips,
  filterGroups,
  orderTechs,
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
  areas: [{ name: "North Carolina" }, { name: "Platinum_AL" }],
  companies: [
    { id: "bp1", name: "SureLock" },
    { id: "bp2", name: "KeyPro" },
  ],
};

const titles = (groups: ReturnType<typeof filterGroups>) => groups.map((g) => g.title);
const labels = (groups: ReturnType<typeof filterGroups>, title: string) =>
  groups.find((g) => g.title === title)?.options.map((o) => o.label);

describe("filterGroups — the columns of the Filter results menu", () => {
  /**
   * Workiz: TECHS, TAGS, JOB TYPE, RECURRING JOBS, SERVICE AREAS. We have no
   * recurring jobs, so its column holds ours — STATUS (the closed statuses,
   * which are not tabs) and COMPANY — and SERVICE AREAS stays fifth.
   */
  it("reads in Workiz's column order, ours in the RECURRING JOBS slot", () => {
    const groups = filterGroups(catalogs, base, "");
    expect(titles(groups)).toEqual(["Techs", "Tags", "Job type", "Status", "Company", "Service Areas"]);
    expect(labels(groups, "Techs")).toEqual(["(2) TX - David Szender", "(2) TX - Matthew Salinas"]);
    expect(labels(groups, "Status")).toEqual(["Done", "Canceled"]);
  });

  /** Workiz sorts by a column header; "sort" is not a filter (audit L14). */
  it("has no Sort group", () => {
    expect(titles(filterGroups(catalogs, base, ""))).not.toContain("Sort");
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

  it("keeps each catalog's own order — no re-sorting by name", () => {
    const groups = filterGroups(
      { ...catalogs, tags: [{ id: "z", name: "TOP PRIORITY", color: "red" }, { id: "a", name: "Needs a call", color: "blue" }] },
      base,
      "",
    );
    expect(labels(groups, "Tags")).toEqual(["TOP PRIORITY", "Needs a call"]);
  });
});

describe("filterAreas — the SERVICE AREAS column", () => {
  const area = (name: string, active = true) => ({ id: name, name, active });

  /**
   * Workiz's default metro "All areas" (is_default) is no filter at all — no
   * chip already means every area — and its menu does not offer it. Areas
   * switched off are still offered: jobs carry them (Workiz lists them too).
   */
  it("leaves out Workiz's default 'All areas', keeps inactive ones, A→Z regardless of case", () => {
    expect(
      filterAreas([area("Platinum_AL"), area("All areas"), area("North Carolina", false), area("PLATINUM ALL STATES", false)]).map(
        (a) => a.name,
      ),
    ).toEqual(["North Carolina", "PLATINUM ALL STATES", "Platinum_AL"]);
  });

  it("copes with no catalog", () => {
    expect(filterAreas(undefined)).toEqual([]);
  });
});

describe("orderTechs — the TECHS column, in Workiz's order", () => {
  /**
   * Workiz lists its team in the order people joined ("(1) YAKOV SZENDER",
   * "(2) IL - DANIEL SZENDER", …); the import keeps when each joined.
   */
  it("orders by when each technician joined, then by name", () => {
    const names = new Map([
      ["a", "Yakov Szender"],
      ["b", "Daniel Szender"],
      ["c", "Bill Ryan"],
      ["d", "Ann Lee"],
    ]);
    expect(
      orderTechs(
        [
          { userId: "c", createdAt: "2023-01-01T00:00:00.000Z" },
          { userId: "a", createdAt: "2019-11-04T03:33:00.000Z" },
          { userId: "d", createdAt: "2023-01-01T00:00:00.000Z" },
          { userId: "b", createdAt: "2019-11-04T04:00:00.000Z" },
        ],
        (id) => names.get(id) ?? id,
      ),
    ).toEqual([
      { id: "a", name: "Yakov Szender" },
      { id: "b", name: "Daniel Szender" },
      { id: "d", name: "Ann Lee" },
      { id: "c", name: "Bill Ryan" },
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

  it("on a backend taking one value per group, a second pick replaces the first", () => {
    let s = chooseFilter(base, { group: "tech", value: "t1", label: "x" }, single);
    s = chooseFilter(s, { group: "tech", value: "t2", label: "x" }, single);
    expect(s.techIds).toEqual(["t2"]);
  });

  it("picks add up (OR inside the group, like Workiz)", () => {
    let s = chooseFilter(base, { group: "tech", value: "t1", label: "x" }, multi);
    s = chooseFilter(s, { group: "tech", value: "t2", label: "x" }, multi);
    s = chooseFilter(s, { group: "tech", value: "t2", label: "x" }, multi);
    expect(s.techIds).toEqual(["t1", "t2"]);
  });

  it("a status opens that status in place of the tab", () => {
    expect(chooseFilter(base, { group: "status", value: "done", label: "Done" }, single).tab).toBe(JobSuperStatus.DONE);
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
    };
    expect(filterChips(state, catalogs).map((c) => c.label)).toEqual([
      "user: (2) TX - David Szender",
      "tag: Needs a call",
      "type: Car lockout",
      "status: Canceled",
      "company: KeyPro",
      "metro: Platinum_AL",
    ]);
  });

  /** The order is shown by the bar on the Scheduled header, never as a chip (audit L14). */
  it("a sort is never a chip", () => {
    expect(filterChips({ ...base, sort: "day_desc" }, catalogs)).toEqual([]);
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
    sort: "day_desc",
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
  });

  it("clear-all empties the control but keeps the search text, Show unpaid jobs and the header's sort", () => {
    const cleared = clearFilters(full);
    expect(filterChips(cleared, catalogs)).toEqual([]);
    expect(cleared).toMatchObject({
      tab: JobSuperStatus.SUBMITTED,
      search: "Dustin",
      unpaid: true,
      techIds: [],
      tagIds: [],
      sort: "day_desc",
    });
  });

  it("clear-all keeps an open tab where it was", () => {
    expect(clearFilters({ ...base, tab: JobSuperStatus.PENDING, techIds: ["t1"] }).tab).toBe(JobSuperStatus.PENDING);
  });
});
