import { describe, expect, it } from "vitest";
import type { CallTrackingCards, CallTrackingRow } from "@bitcrm/types";
import {
  bucketLabel,
  callTrackingColumns,
  callTrackingQuery,
  cardDuration,
  graphView,
  pct,
  rowDuration,
  seriesColor,
  sortTrackingRows,
  trackingCardFigures,
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

const cards = (over: Partial<CallTrackingCards> = {}): CallTrackingCards => ({
  incomingCalls: 2652,
  callers: 1848,
  missedCalls: 415,
  topFlow: "(2-CT-O) SURE CT ORGANIC",
  avgDurationSeconds: 90.08,
  conversion: 26.13,
  revenue: 78160.39,
  ...over,
});

describe("Call Tracking cells", () => {
  it("prints the Avg Duration card from the rows' mean, rounded — Workiz's 290.5 s is 4 Min 51 Sec", () => {
    expect(cardDuration(290.5)).toBe("4 Min 51 Sec");
    expect(cardDuration(94.2)).toBe("1 Min 34 Sec");
    expect(cardDuration(94.5)).toBe("1 Min 35 Sec");
    expect(cardDuration(25)).toBe("25 Sec");
    expect(cardDuration(0)).toBe("0 Sec");
  });

  it("prints a row's average as Workiz does — no answered call is \"0sec\"", () => {
    expect(rowDuration(146)).toBe("2 min 26 sec");
    expect(rowDuration(620)).toBe("10 min 20 sec");
    expect(rowDuration(20)).toBe("20 sec");
    expect(rowDuration(0)).toBe("0sec");
  });

  it("prints money and rates without thousands separators, as react-table does", () => {
    expect(usd(289484.03)).toBe("$289484.03");
    expect(usd(0)).toBe("$0.00");
    expect(usd(undefined)).toBe("$0.00");
    expect(pct(31.68)).toBe("31.68%");
    expect(pct(79.5)).toBe("79.5%");
    expect(pct(0)).toBe("0%");
  });

  it("names the graph's buckets as Workiz does", () => {
    expect(bucketLabel("hour", "00")).toBe("12:00 AM");
    expect(bucketLabel("hour", "13")).toBe("1:00 PM");
    expect(bucketLabel("day", "2026-10-01")).toBe("10/01/26");
    // Weeks of the month: the 1st–7th is week 1, the 29th on week 5.
    expect(bucketLabel("week", "2026-10-08")).toBe("week 2  In Oct");
    expect(bucketLabel("week", "2026-09-29")).toBe("week 5  In Sep");
    expect(bucketLabel("month", "2026-10")).toBe("10/26");
  });

  it("asks for one window, grouping and step", () => {
    expect(callTrackingQuery({ from: "2026-09-01", to: "2026-09-29", groupBy: "numbers", graphBy: "day" })).toBe(
      "from=2026-09-01&to=2026-09-29&groupBy=numbers&graphBy=day",
    );
  });
});

describe("Call Tracking cards", () => {
  it("prints Workiz's seven cards — raw counts, the rounded duration, two-decimal conversion, bare dollars", () => {
    expect(trackingCardFigures(cards(), { hasRows: true, money: true })).toEqual([
      { caption: "Incoming calls", value: "2652" },
      { caption: "Callers", value: "1848" },
      { caption: "Missed calls", value: "415" },
      { caption: "Top Flow", value: "(2-CT-O) SURE CT ORGANIC" },
      { caption: "Avg Duration", value: "1 Min 30 Sec" },
      { caption: "Conversion", value: "26.13%" },
      { caption: "Revenue", value: "$78160.39" },
    ]);
  });

  it("keeps the two decimals on a zero conversion, and reads 0% and N/A over an empty period", () => {
    const zero = cards({ conversion: 0, revenue: 0, topFlow: "(8-AZ-SLS) SLS AZ GOOGLE ADS" });
    expect(trackingCardFigures(zero, { hasRows: true, money: true })[5].value).toBe("0.00%");
    const empty = cards({ incomingCalls: 0, callers: 0, missedCalls: 0, topFlow: null, avgDurationSeconds: 0, conversion: 0, revenue: 0 });
    expect(trackingCardFigures(empty, { hasRows: false, money: true }).map((c) => c.value)).toEqual([
      "0", "0", "0", "N/A", "0 Sec", "0%", "$0.00",
    ]);
  });

  it("leaves Revenue out without financials", () => {
    expect(trackingCardFigures(cards(), { hasRows: true, money: false }).map((c) => c.caption)).not.toContain("Revenue");
  });
});

describe("Call Tracking graph", () => {
  it("plots only the buckets that had calls, in time order, and the flows by name", () => {
    const view = graphView({
      graphBy: "hour",
      buckets: ["00", "01", "02"],
      series: [
        { name: "B flow", counts: [0, 0, 1] },
        { name: " A flow", counts: [2, 0, 0] },
      ],
    });
    expect(view.labels).toEqual(["12:00 AM", "2:00 AM"]);
    // Workiz sorts its datasets by name; a leading space sorts first.
    expect(view.series.map((s) => [s.label, s.values])).toEqual([
      [" A flow", [2, 0]],
      ["B flow", [0, 1]],
    ]);
  });

  it("colours the first eight flows from Workiz's palette and the rest from their names", () => {
    const first = Array.from({ length: 8 }, (_, i) => seriesColor(i, `F${i}`));
    expect(new Set(first).size).toBe(8);
    expect(first[0]).toBe("var(--wz-series1)");
    expect(seriesColor(8, "(2-CT-O) SURE CT ORGANIC")).toMatch(/^rgb\(\d{1,3} \d{1,3} \d{1,3}\)$/);
    expect(seriesColor(40, "(2-CT-O) SURE CT ORGANIC")).toBe(seriesColor(8, "(2-CT-O) SURE CT ORGANIC"));
    expect(seriesColor(8, "Another flow")).not.toBe(seriesColor(8, "(2-CT-O) SURE CT ORGANIC"));
  });
});

describe("Call Tracking table", () => {
  it("has Workiz's twelve columns — Number instead of Flow by number, no Revenue without financials, the rates wider", () => {
    const cols = callTrackingColumns("flows", true);
    expect(cols.map((c) => c.label)).toEqual([
      "Flow", "Ad group", "Calls", "Callers", "Completed", "Missed", "Avg duration", "Jobs", "Leads",
      "Job conversion rate", "Revenue", "Lead conversion rate",
    ]);
    expect(cols.filter((c) => c.wide).map((c) => c.key)).toEqual(["jobsConversionRate", "leadsConversionRate"]);
    expect(callTrackingColumns("numbers", false).map((c) => c.label)).not.toContain("Revenue");
    expect(callTrackingColumns("numbers", false)[0].label).toBe("Number");
  });

  it("sorts in the browser as react-table does: text lower-cased by code point, numbers by value, ties in the server's order", () => {
    const rows = [
      row({ name: "b", callers: 5, adGroupId: "g2" }),
      row({ name: "A", callers: 9, adGroupId: "g1" }),
      row({ name: " c", callers: 5 }),
    ];
    const names = { g1: "Yelp", g2: "Google" } as Record<string, string>;
    const of = (id?: string) => (id ? names[id] : "");
    expect(sortTrackingRows(rows, null, of).map((r) => r.name)).toEqual(["b", "A", " c"]);
    expect(sortTrackingRows(rows, { by: "callers", dir: "asc" }, of).map((r) => r.name)).toEqual(["b", " c", "A"]);
    expect(sortTrackingRows(rows, { by: "callers", dir: "desc" }, of).map((r) => r.name)).toEqual(["A", "b", " c"]);
    expect(sortTrackingRows(rows, { by: "name", dir: "asc" }, of).map((r) => r.name)).toEqual([" c", "A", "b"]);
    expect(sortTrackingRows(rows, { by: "adGroup", dir: "asc" }, of).map((r) => r.name)).toEqual([" c", "b", "A"]);
  });
});
