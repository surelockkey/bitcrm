import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  RANGE_PRESETS,
  filterCount,
  parseReportState,
  presetRange,
  reportHref,
  type ReportState,
} from "./params";

const TODAY = "2026-09-30";

const parse = (qs: string) => parseReportState(new URLSearchParams(qs), TODAY);

describe("presetRange", () => {
  it("offers Workiz's presets, This month first", () => {
    expect(RANGE_PRESETS.map((p) => p.value)).toEqual([
      "this_month",
      "last_14_days",
      "last_30_days",
      "last_month",
      "custom",
    ]);
  });

  it("this month runs from the 1st to today", () => {
    expect(presetRange("this_month", TODAY)).toEqual({ from: "2026-09-01", to: TODAY });
  });

  it("the last N days include today", () => {
    expect(presetRange("last_14_days", TODAY)).toEqual({ from: "2026-09-17", to: TODAY });
    expect(presetRange("last_30_days", TODAY)).toEqual({ from: "2026-09-01", to: TODAY });
    expect(presetRange("last_30_days", "2026-03-05")).toEqual({ from: "2026-02-04", to: "2026-03-05" });
  });

  it("last month is the whole previous calendar month", () => {
    expect(presetRange("last_month", TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("parseReportState", () => {
  it("opens on the Usage tab, this month, nothing filtered", () => {
    expect(parse("")).toEqual({
      tab: "usage",
      preset: "this_month",
      from: "2026-09-01",
      to: TODAY,
      filters: EMPTY_FILTERS,
    } satisfies ReportState);
  });

  it("reads the tab, and ignores one it doesn't know", () => {
    expect(parse("tab=returns").tab).toBe("returns");
    expect(parse("tab=log").tab).toBe("log");
    expect(parse("tab=nope").tab).toBe("usage");
  });

  it("reads a preset and derives its days", () => {
    const s = parse("range=last_month");
    expect(s).toMatchObject({ preset: "last_month", from: "2026-08-01", to: "2026-08-31" });
  });

  it("an unknown preset falls back to this month", () => {
    expect(parse("range=forever")).toMatchObject({ preset: "this_month", from: "2026-09-01" });
  });

  it("a custom range takes its days from the URL", () => {
    expect(parse("range=custom&from=2023-01-01&to=2023-10-20")).toMatchObject({
      preset: "custom",
      from: "2023-01-01",
      to: "2023-10-20",
    });
  });

  it("a custom range never goes open-ended or backwards", () => {
    // A missing or malformed end is today; a missing start is the end's day.
    expect(parse("range=custom&from=2026-09-10")).toMatchObject({ from: "2026-09-10", to: TODAY });
    expect(parse("range=custom&to=2026-09-10")).toMatchObject({ from: "2026-09-10", to: "2026-09-10" });
    expect(parse("range=custom&from=junk&to=2026-09-10")).toMatchObject({ from: "2026-09-10", to: "2026-09-10" });
    // Reversed: swapped rather than an empty report.
    expect(parse("range=custom&from=2026-09-20&to=2026-09-10")).toMatchObject({
      from: "2026-09-10",
      to: "2026-09-20",
    });
  });

  it("reads every filter group, several values each", () => {
    expect(
      parse("tech=u1&tech=u2&location=w1&category=Locks&category=Keys&brand=b1").filters,
    ).toEqual({
      techIds: ["u1", "u2"],
      locationIds: ["w1"],
      categories: ["Locks", "Keys"],
      brandIds: ["b1"],
    });
  });

  it("drops empty and repeated values", () => {
    expect(parse("tech=&tech=u1&tech=u1").filters.techIds).toEqual(["u1"]);
  });
});

describe("reportHref", () => {
  const base = parse("");

  it("the default view is the bare path", () => {
    expect(reportHref(base)).toBe("/reports/inventory-usage");
  });

  it("writes only what differs from the default, filters repeated", () => {
    const href = reportHref({
      ...base,
      tab: "log",
      preset: "last_14_days",
      filters: { ...EMPTY_FILTERS, techIds: ["u1", "u2"], brandIds: ["b1"] },
    });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/reports/inventory-usage");
    expect(url.searchParams.get("tab")).toBe("log");
    expect(url.searchParams.get("range")).toBe("last_14_days");
    expect(url.searchParams.getAll("tech")).toEqual(["u1", "u2"]);
    expect(url.searchParams.getAll("brand")).toEqual(["b1"]);
    // A preset's days are derived, never written.
    expect(url.searchParams.has("from")).toBe(false);
  });

  it("a custom range carries its days", () => {
    const href = reportHref({ ...base, preset: "custom", from: "2023-01-01", to: "2023-10-20" });
    const url = new URL(href, "http://x");
    expect(url.searchParams.get("from")).toBe("2023-01-01");
    expect(url.searchParams.get("to")).toBe("2023-10-20");
  });

  it("round-trips through the parser", () => {
    const state: ReportState = {
      tab: "returns",
      preset: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
      filters: { techIds: ["u1"], locationIds: ["c1", "w1"], categories: ["Locks"], brandIds: [] },
    };
    const url = new URL(reportHref(state), "http://x");
    expect(parseReportState(url.searchParams, TODAY)).toEqual(state);
  });
});

describe("filterCount", () => {
  it("counts the picks across every group", () => {
    expect(filterCount(EMPTY_FILTERS)).toBe(0);
    expect(filterCount({ techIds: ["a"], locationIds: ["b", "c"], categories: [], brandIds: ["d"] })).toBe(4);
  });
});
