import { describe, expect, it } from "vitest";
import type { JobStatisticsDay, JobStatisticsRow, JobStatisticsTable } from "@bitcrm/types";
import {
  STATISTICS_PRESETS,
  columnsFor,
  groupSeries,
  pieOf,
  rowName,
  searchRows,
  sortRows,
  sourcesOf,
  statisticsParams,
  tableCsv,
  totalsOf,
} from "./lib";
import { presetRange } from "../jobs/lib";

const row = (key: string, label: string, all: number, done: number, canceled: number, over: Partial<JobStatisticsRow> = {}): JobStatisticsRow => ({
  key,
  label,
  all,
  done,
  open: all - done - canceled,
  canceled,
  canceledPct: all ? Math.round((canceled / all) * 10_000) / 100 : 0,
  ...over,
});

describe("statisticsParams", () => {
  it("asks for the period on its By Time date, with only the filters that are set", () => {
    expect(statisticsParams({ by: "end", from: "2026-09-01", to: "2026-09-27" })).toBe("by=end&from=2026-09-01&to=2026-09-27");
    expect(
      statisticsParams({ by: "created", from: "2026-09-01", to: "2026-09-30", serviceAreaId: "sa1", tagIds: ["a", "b"] }),
    ).toBe("by=created&from=2026-09-01&to=2026-09-30&serviceAreaId=sa1&tagId=a%2Cb");
    expect(statisticsParams({ by: "scheduled", from: "2026-09-01", to: "2026-09-01", tagIds: [] })).toBe("by=scheduled&from=2026-09-01&to=2026-09-01");
  });

  it("offers Workiz's thirteen presets, each one a range the Jobs report can compute", () => {
    expect(STATISTICS_PRESETS.map((p) => p.label)).toEqual([
      "Custom",
      "Today",
      "Yesterday",
      "This week (Sun-Today)",
      "This week (Mon-Today)",
      "Last 7 days",
      "Last week (Sun-Sat)",
      "Last week (Mon-Sun)",
      "Last business week (Mon-Fri)",
      "Last 14 days",
      "This month",
      "Last 30 days",
      "Last month",
    ]);
    for (const p of STATISTICS_PRESETS) if (p.id !== "custom") expect(presetRange(p.id, "2026-09-29").from).toMatch(/^2026-/);
  });
});

describe("groupSeries", () => {
  const days: JobStatisticsDay[] = [
    { date: "2026-08-31", jobs: 1, canceled: 0, done: 1, sales: 10.1, profit: 5 }, // Monday
    { date: "2026-09-01", jobs: 2, canceled: 1, done: 1, sales: 20.2, profit: 8 },
    { date: "2026-09-07", jobs: 1, canceled: 0, done: 0, sales: 0, profit: 0 }, // next Monday
  ];

  it("keeps days as they are", () => {
    expect(groupSeries(days, "day")).toEqual(days);
  });

  it("sums Monday-started weeks and calendar months, keyed by their first day, to the cent", () => {
    expect(groupSeries(days, "week")).toEqual([
      { date: "2026-08-31", jobs: 3, canceled: 1, done: 2, sales: 30.3, profit: 13 },
      { date: "2026-09-07", jobs: 1, canceled: 0, done: 0, sales: 0, profit: 0 },
    ]);
    expect(groupSeries(days, "month").map((d) => d.date)).toEqual(["2026-08-01", "2026-09-01"]);
  });

  it("leaves the money out when the answer has none", () => {
    expect(groupSeries([{ date: "2026-09-01", jobs: 2, canceled: 1, done: 1 }], "month")).toEqual([
      { date: "2026-09-01", jobs: 2, canceled: 1, done: 1 },
    ]);
  });
});

describe("tables", () => {
  const sources: JobStatisticsTable = {
    rows: [
      row("ad:GMB", "SURE TX DENISON GMB", 63, 20, 43, { kind: "ad", gross: 5761.88, profit: 3987.71, avgSale: 288.09, avgProfit: 199.39 }),
      row("external:e1", "Papas Lock Out Service", 7, 2, 5, { kind: "external", gross: 375, profit: 121.27, avgSale: 187.5, avgProfit: 60.64 }),
      row("external:e2", "YIGAL dr locks stamford", 1, 0, 0, { kind: "external", gross: 0, profit: 0, avgSale: 0, avgProfit: 0 }),
    ],
    totals: { all: 71, done: 22, open: 1, canceled: 48, canceledPct: 67.61, gross: 6136.88, profit: 4108.98, avgSale: 278.95, avgProfit: 186.77 },
  };

  it("switches Sources between all, ad groups and referrals, the Totals following", () => {
    expect(sourcesOf(sources, "all")).toBe(sources);
    const ext = sourcesOf(sources, "external");
    expect(ext.rows.map((r) => r.label)).toEqual(["Papas Lock Out Service", "YIGAL dr locks stamford"]);
    // Workiz "Only referrals": 8, 2, 1, 5, 62.50%, 375, 121.27, 187.50, 60.64.
    expect(ext.totals).toEqual({ all: 8, done: 2, open: 1, canceled: 5, canceledPct: 62.5, gross: 375, profit: 121.27, avgSale: 187.5, avgProfit: 60.64 });
    expect(sourcesOf(sources, "ad").rows).toHaveLength(1);
  });

  it("recomputes Totals without money when the rows carry none", () => {
    expect(totalsOf([row("a", "A", 3, 1, 1), row("b", "B", 1, 1, 0)])).toEqual({ all: 4, done: 2, open: 1, canceled: 1, canceledPct: 25 });
  });

  it("spells blanks out", () => {
    expect(rowName("tech", row("unassigned", "", 1, 0, 1, { techIds: [] }))).toBe("Unassigned");
    expect(rowName("sources", row("ad:", "", 1, 0, 1, { kind: "ad" }))).toBe("No source");
    expect(rowName("sources", row("ad-id:x", "", 1, 0, 1, { kind: "ad" }))).toBe("Unknown source");
    expect(rowName("area", row("zip:", "", 1, 0, 1), "zip")).toBe("No zip");
    expect(rowName("area", row("city:", "", 1, 0, 1), "city")).toBe("No city");
    expect(rowName("dispatcher", row("text:x", "(1) (Mia) 7 Dispatcher", 1, 0, 1))).toBe("(1) (Mia) 7 Dispatcher");
  });

  it("lays out Workiz's columns per tab and drill, money and profit only when shown", () => {
    const labels = (tab: Parameters<typeof columnsFor>[0], drill: Parameters<typeof columnsFor>[1], money: boolean, profit: boolean) =>
      columnsFor(tab, drill, { money, profit }).map((c) => c.label);
    expect(labels("tech", "metro", true, true)).toEqual([
      "Tech",
      "All Jobs",
      "Done Jobs",
      "Open Jobs",
      "Canceled Jobs",
      "Canceled %",
      "Gross Amount",
      "Profit",
      "Labor cost",
      "Tech expenses",
      "Average Sale",
      "Average Profit",
    ]);
    expect(labels("sources", "metro", true, false)).toEqual(["Job Source", "All Jobs", "Done Jobs", "Open Jobs", "Canceled Jobs", "Canceled %", "Gross Amount", "Average Sale"]);
    expect(labels("dispatcher", "metro", false, false)).toEqual(["Dispatcher", "All Jobs", "Done Jobs", "Open Jobs", "Canceled Jobs", "Canceled %"]);
    expect(labels("area", "metro", false, false).slice(0, 2)).toEqual(["Service Area", "All Jobs"]);
    expect(labels("area", "city", false, false).slice(0, 3)).toEqual(["City", "Service Area", "All Jobs"]);
    expect(labels("area", "zip", false, false).slice(0, 3)).toEqual(["Zip", "City", "All Jobs"]);
  });

  it("sorts on any column, names alphabetically, numbers by size", () => {
    const nameOf = (r: JobStatisticsRow) => r.label;
    expect(sortRows(sources.rows, "all", "desc", nameOf).map((r) => r.all)).toEqual([63, 7, 1]);
    expect(sortRows(sources.rows, "name", "asc", nameOf).map((r) => r.label)).toEqual([
      "Papas Lock Out Service",
      "SURE TX DENISON GMB",
      "YIGAL dr locks stamford",
    ]);
    expect(sortRows(sources.rows, "gross", "asc", nameOf).map((r) => r.gross)).toEqual([0, 375, 5761.88]);
  });

  it("searches an Area table by its name columns", () => {
    const rows = [row("city:Denison", "Denison", 77, 31, 46, { serviceArea: "SURE LOCK SHERMAN TX" }), row("city:Hartford", "Hartford", 5, 4, 1, { serviceArea: "SURE LOCK CT" })];
    expect(searchRows(rows, "sherman", (r) => r.label).map((r) => r.label)).toEqual(["Denison"]);
    expect(searchRows(rows, " ", (r) => r.label)).toHaveLength(2);
  });

  it("cuts a pie to the three biggest and Other, percents of the whole", () => {
    const rows = [row("a", "A", 10, 4, 0), row("b", "B", 10, 3, 0), row("c", "C", 10, 1, 0), row("d", "D", 10, 1, 0), row("e", "E", 10, 1, 0), row("z", "Z", 10, 0, 0)];
    expect(pieOf(rows, "done", (r) => r.label)).toEqual([
      { key: "a", name: "A", count: 4, percent: 40 },
      { key: "b", name: "B", count: 3, percent: 30 },
      { key: "c", name: "C", count: 1, percent: 10 },
      { key: "__other__", name: "Other", count: 2, percent: 20 },
    ]);
    // Four rows or fewer: every one its own slice.
    expect(pieOf(rows.slice(0, 4), "done", (r) => r.label).map((s) => s.name)).toEqual(["A", "B", "C", "D"]);
    expect(pieOf(sources.rows, "gross", (r) => r.label).map((s) => s.name)).toEqual(["SURE TX DENISON GMB", "Papas Lock Out Service"]);
    expect(pieOf([row("x", "X", 1, 0, 1)], "done", (r) => r.label)).toEqual([]);
  });

  it("exports the table as Workiz's Export List: header, rows, Totals last", () => {
    const columns = columnsFor("sources", "metro", { money: true, profit: true });
    const csv = tableCsv(columns, sources.rows.slice(0, 2), sources.totals, (r) => r.label).split("\r\n");
    expect(csv[0]).toBe("Job Source,All Jobs,Done Jobs,Open Jobs,Canceled Jobs,Canceled %,Gross Amount,Profit,Average Sale,Average Profit");
    expect(csv[1]).toBe("SURE TX DENISON GMB,63,20,0,43,68.25%,5761.88,3987.71,288.09,199.39");
    expect(csv.at(-1)).toBe("Totals:,71,22,1,48,67.61%,6136.88,4108.98,278.95,186.77");
  });

  it("defuses a name a spreadsheet would run as a formula", () => {
    const csv = tableCsv(columnsFor("area", "zip", { money: false, profit: false }), [row("zip:-", "-", 1, 0, 1, { city: "=cmd" })], totalsOf([]), (r) => r.label);
    expect(csv.split("\r\n")[1]).toBe("'-,'=cmd,1,0,0,1,100%");
  });
});
