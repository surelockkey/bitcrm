import { describe, expect, it } from "vitest";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { EMPTY_JOBS_LIST_STATE, toCountsParams, toListParams } from "@/features/deals/query-params";
import type { FilterCatalogs } from "@/features/deals/job-filters";
import { compareVisitOrder, inRouteOrder, myJobHref, myJobsCatalogs, myJobsListState, routeStop } from "./my-jobs-list";

describe("myJobsListState — the jobs list, only the viewer's jobs", () => {
  it("asks for the viewer's jobs whatever the controls hold", () => {
    const state = { ...EMPTY_JOBS_LIST_STATE, techIds: ["someone-else", "t2"] };
    expect(myJobsListState(state, "t1").techIds).toEqual(["t1"]);
  });

  it("keeps every other control as it is: tab, search, filters, sort, unpaid", () => {
    const state = {
      ...EMPTY_JOBS_LIST_STATE,
      tab: JobSuperStatus.IN_PROGRESS,
      search: "Dustin",
      tagIds: ["tag-1"],
      jobTypeIds: ["jt-1"],
      serviceAreas: ["North"],
      sort: "day_desc" as const,
      unpaid: true,
    };
    expect(myJobsListState(state, "t1")).toEqual({ ...state, techIds: ["t1"] });
  });

  it("sends the viewer as the list's and the tabs' tech filter", () => {
    const mine = myJobsListState(EMPTY_JOBS_LIST_STATE, "t1");
    expect(toListParams(mine).techIds).toBe("t1");
    expect(toCountsParams(mine).techIds).toBe("t1");
  });
});

describe("myJobsCatalogs — Filter results without a TECHS column", () => {
  it("drops the technicians (the list is always yours) and keeps the rest", () => {
    const catalogs: FilterCatalogs = {
      techs: [{ id: "t1", name: "Tess Tech" }],
      tags: [{ id: "tag-1", name: "Needs a call", color: "blue" } as FilterCatalogs["tags"][number]],
      jobTypes: [{ id: "jt-1", name: "Lockout" }],
      areas: [{ name: "North" }],
      companies: [{ id: "bp-1", name: "SureLock" }],
    };
    expect(myJobsCatalogs(catalogs)).toEqual({ ...catalogs, techs: [] });
  });
});

describe("the dispatcher's route order (ours, kept from the day cards)", () => {
  const job = (id: string, day: string | undefined, slot: string | undefined, stop?: number) =>
    ({
      id,
      dealNumber: id.toUpperCase(),
      scheduledDate: day,
      scheduledTimeSlot: slot,
      sequences: stop === undefined ? undefined : { t1: stop, t9: 99 - stop },
    }) as unknown as Deal;
  const ids = (deals: Deal[]) => deals.map((d) => d.id);

  it("orders a day by the stop the dispatcher set, then the slot, then the job number", () => {
    const a = job("a", "2026-10-09", "09:00-10:00", 2);
    const b = job("b", "2026-10-09", "13:00-14:00", 1);
    const c = job("c", "2026-10-09", "08:00-09:00");
    const d = job("d", "2026-10-09", "08:00-09:00");
    expect([a, b, c, d].sort((x, y) => compareVisitOrder(x, y, "t1")).map((x) => x.id)).toEqual(["b", "a", "c", "d"]);
    // Somebody else's route order is not the viewer's.
    expect([b, a].sort((x, y) => compareVisitOrder(x, y, "t2")).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("reorders the rows within each day only, the days staying where the server put them", () => {
    const rows = [
      job("a", "2026-10-09", "09:00-10:00", 2),
      job("b", "2026-10-09", "13:00-14:00", 1),
      job("c", "2026-10-10", "08:00-09:00", 2),
      job("d", "2026-10-10", "10:00-11:00", 1),
    ];
    expect(ids(inRouteOrder(rows, "t1", "none"))).toEqual(["b", "a", "d", "c"]);
    // Latest first: the days come latest first, and so does each day's route.
    const desc = [rows[3], rows[2], rows[1], rows[0]];
    expect(ids(inRouteOrder(desc, "t1", "day_desc"))).toEqual(["c", "d", "a", "b"]);
  });

  it("leaves unscheduled jobs as they came", () => {
    const rows = [job("a", undefined, undefined, 2), job("b", undefined, undefined, 1)];
    expect(ids(inRouteOrder(rows, "t1", "none"))).toEqual(["a", "b"]);
  });

  it("the stop number is the viewer's own place in the day, only on a scheduled job", () => {
    expect(routeStop(job("a", "2026-10-09", "09:00-10:00", 3), "t1")).toBe(3);
    expect(routeStop(job("a", "2026-10-09", "09:00-10:00", 3), "t2")).toBeUndefined();
    expect(routeStop(job("a", undefined, undefined, 3), "t1")).toBeUndefined();
  });
});

describe("myJobHref", () => {
  it("opens the job on the technician's own route", () => {
    expect(myJobHref("d-42")).toBe("/my-jobs/d-42");
  });
});
