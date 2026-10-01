import { describe, expect, it } from "vitest";
import type { CallTrackingRow } from "@bitcrm/types";
import {
  bucketLabel,
  callTrackingColumns,
  callTrackingQuery,
  cardDuration,
  pct,
  rowDuration,
  sortTrackingRows,
  usd,
} from "./lib";

const row = (over: Partial<CallTrackingRow>): CallTrackingRow => ({
  key: over.name ?? "k",
  name: "Flow",
  calls: 1,
  callers: 1,
  completed: 1,
  missed: 0,
  avgDurationSeconds: 0,
  jobs: 0,
  leads: 0,
  jobsConversionRate: 0,
  leadsConversionRate: 0,
  ...over,
});

describe("Call Tracking cells", () => {
  it("prints durations the way Workiz does", () => {
    expect(cardDuration(94.2)).toBe("1 Min 34 Sec");
    expect(cardDuration(68)).toBe("1 Min 8 Sec");
    expect(rowDuration(146)).toBe("2 min 26 sec");
    expect(rowDuration(20)).toBe("20 sec");
  });

  it("prints money, percentages and the graph's buckets", () => {
    expect(usd(289484.03)).toBe("$289,484.03");
    expect(pct(31.68)).toBe("31.68%");
    expect(pct(62.67)).toBe("62.67%");
    expect(bucketLabel("hour", "00")).toBe("12:00 AM");
    expect(bucketLabel("hour", "13")).toBe("1:00 PM");
    expect(bucketLabel("day", "2026-09-06")).toBe("Sep 6");
    expect(bucketLabel("month", "2026-09")).toBe("Sep 2026");
  });

  it("asks for one window, grouping and step", () => {
    expect(callTrackingQuery({ from: "2026-09-01", to: "2026-09-29", groupBy: "numbers", graphBy: "day" })).toBe(
      "from=2026-09-01&to=2026-09-29&groupBy=numbers&graphBy=day",
    );
  });
});

describe("Call Tracking table", () => {
  it("has Workiz's twelve columns — Number instead of Flow by number, no Revenue without financials", () => {
    expect(callTrackingColumns("flows", true).map((c) => c.label)).toEqual([
      "Flow", "Ad group", "Calls", "Callers", "Completed", "Missed", "Avg duration", "Jobs", "Leads",
      "Job conversion rate", "Revenue", "Lead conversion rate",
    ]);
    expect(callTrackingColumns("numbers", false).map((c) => c.label)).not.toContain("Revenue");
    expect(callTrackingColumns("numbers", false)[0].label).toBe("Number");
  });

  it("sorts in the browser, by numbers or by text, and keeps the server's order otherwise", () => {
    const rows = [row({ name: "B", callers: 5, adGroupId: "g2" }), row({ name: "A", callers: 9, adGroupId: "g1" }), row({ name: "C", callers: 5 })];
    const names = { g1: "Yelp", g2: "Google" } as Record<string, string>;
    const of = (id?: string) => (id ? names[id] : "");
    expect(sortTrackingRows(rows, null, of).map((r) => r.name)).toEqual(["B", "A", "C"]);
    expect(sortTrackingRows(rows, { by: "callers", dir: "desc" }, of).map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(sortTrackingRows(rows, { by: "name", dir: "asc" }, of).map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(sortTrackingRows(rows, { by: "adGroup", dir: "asc" }, of).map((r) => r.name)).toEqual(["C", "B", "A"]);
  });
});
