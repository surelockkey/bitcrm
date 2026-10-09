import { describe, expect, it } from "vitest";
import type { Estimate } from "@bitcrm/types";
import {
  DEFAULT_ESTIMATES_RANGE,
  ESTIMATES_LIST_COLUMNS,
  ESTIMATES_LIST_PRESETS,
  estimateCardText,
  estimateSourceLabel,
  estimateUpdatedOn,
  estimatesListParams,
  estimatesListRange,
  estimatesRangeText,
  estimatesWindow,
  nextCreatedSort,
  openCustom,
} from "./estimates-list";

const est = (over: Partial<Estimate>): Estimate =>
  ({
    id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", contactId: "c1",
    name: "Front door", status: "pending", estimateDate: "2026-09-16",
    version: 1, createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "",
    ...over,
  }) as Estimate;

// A Friday.
const TODAY = "2026-10-09";

describe("the period box (pg_estimates_wz_09_period_open)", () => {
  it("lists Workiz's fifteen in Workiz's words, then All time — ours, so the opening view can come back", () => {
    expect(ESTIMATES_LIST_PRESETS.map((p) => p.label)).toEqual([
      "Custom",
      "Today",
      "Yesterday",
      "Last 7 days",
      "Last 14 days",
      "Last 30 days",
      "Last month",
      "This month",
      "This year",
      "Last year",
      "This week (Sun-Today)",
      "This week (Mon-Today)",
      "Last week (Sun-Sat)",
      "Last week (Mon-Sun)",
      "Last business week (Mon-Fri)",
      "All time",
    ]);
  });

  it("opens on All time, which reads All time twice and asks for no days", () => {
    expect(DEFAULT_ESTIMATES_RANGE).toEqual({ preset: "all_time", from: "", to: "" });
    expect(estimatesRangeText(DEFAULT_ESTIMATES_RANGE)).toBe("All time");
    expect(estimatesWindow(DEFAULT_ESTIMATES_RANGE)).toEqual({ window: {}, error: null });
  });

  it("counts a preset's days as Workiz's datepicker does; Custom has none of its own", () => {
    expect(estimatesListRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(estimatesListRange("last_month", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(estimatesListRange("all_time", TODAY)).toEqual({ from: "", to: "" });
    expect(estimatesListRange("custom", TODAY)).toBeNull();
    expect(estimatesRangeText({ preset: "today", from: TODAY, to: TODAY })).toBeUndefined();
  });

  it("windows the list on the days; refuses a custom span over twelve months in Workiz's words", () => {
    expect(estimatesWindow({ preset: "this_month", from: "2026-10-01", to: TODAY })).toEqual({
      window: { from: "2026-10-01", to: TODAY },
      error: null,
    });
    expect(estimatesWindow({ preset: "custom", from: "2025-01-01", to: TODAY })).toEqual({
      window: null,
      error: "Date range exceeds 12 months",
    });
  });

  it("opens Custom on today when there are no days to keep (from All time)", () => {
    expect(openCustom({ preset: "custom", from: "", to: "" }, TODAY)).toEqual({ preset: "custom", from: TODAY, to: TODAY });
    const kept = { preset: "custom", from: "2026-10-01", to: "2026-10-05" };
    expect(openCustom(kept, TODAY)).toBe(kept);
  });
});

describe("the status cards (uikit_wz_estimates)", () => {
  it("names the status big and prints 'N Worth $X' under it — the count without separators, as Workiz", () => {
    expect(estimateCardText("unsent", { count: 3371, amount: 4868596.54 })).toEqual({
      value: "Unsent",
      caption: "3371 Worth $4,868,596.54",
      label: "3371 Worth $4,868,596.54 Unsent",
    });
    expect(estimateCardText("won", undefined).caption).toBe("0 Worth $0.00");
  });
});

describe("the row", () => {
  it("names the job it came from; a client estimate (no job) leaves Source blank, as Workiz leaves empty cells", () => {
    expect(estimateSourceLabel(est({}))).toBe("Job - 1042");
    expect(estimateSourceLabel(est({ dealId: undefined, dealNumber: undefined }))).toBe("");
  });

  it("dates an approved, declined or won estimate under its status ('Oct 08, 2026', New York)", () => {
    expect(estimateUpdatedOn(est({ status: "won", wonAt: "2026-10-09T02:30:00.000Z" }))).toBe("Oct 08, 2026");
    expect(estimateUpdatedOn(est({ status: "approved", approvedAt: "2026-09-30T15:00:00.000Z" }))).toBe("Sep 30, 2026");
    expect(estimateUpdatedOn(est({ status: "declined" }))).toBeUndefined();
    expect(estimateUpdatedOn(est({ status: "pending", wonAt: "2026-10-09T02:30:00.000Z" }))).toBeUndefined();
  });
});

describe("the grid's columns", () => {
  it("are Workiz's eight in its order, Status fixed at 210 and Client twice the rest", () => {
    expect(ESTIMATES_LIST_COLUMNS.map((c) => c.label)).toEqual([
      "Estimate",
      "Estimate Name",
      "Client",
      "Created",
      "Amount",
      "Status",
      "Source",
      "Deposit due",
    ]);
    const w = Object.fromEntries(ESTIMATES_LIST_COLUMNS.map((c) => [c.id, c.width]));
    expect(w.status).toBe(210);
    expect(w.client).toBe(2 * w.number);
    expect(new Set([w.number, w.name, w.created, w.total, w.job, w.deposit]).size).toBe(1);
  });
});

describe("the request", () => {
  it("sends the window, the status, the search and turns Created round only when asked", () => {
    expect(estimatesListParams({ window: {}, status: "all", search: "", dir: "desc" })).toEqual({});
    expect(
      estimatesListParams({ window: { from: "2026-10-01", to: TODAY }, status: "won", search: "ztn", dir: "asc" }),
    ).toEqual({ from: "2026-10-01", to: TODAY, status: "won", search: "ztn", dir: "asc" });
  });

  it("turns Created round on a click: newest first ↔ oldest first (pg_estimates_wz_13c_sort_created)", () => {
    expect(nextCreatedSort("desc")).toBe("asc");
    expect(nextCreatedSort("asc")).toBe("desc");
  });
});
