import { describe, expect, it } from "vitest";
import type { JobStatisticsDay, JobStatisticsRow, JobStatisticsTable } from "@bitcrm/types";
import {
  DEFAULT_SORT,
  STATISTICS_PRESETS,
  cellText,
  columnsFor,
  groupSeries,
  nextSort,
  pieSlices,
  rowName,
  seriesLabel,
  wzMoney,
  wzNumber,
  wzPercent,
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
      // Workiz's own spelling, the missing space included (rep_jobstats_wz_07_period_open).
      "This week(Sun - Today)",
      "This week (Mon - Today)",
      "Last 7 days",
      "Last week (Sun - Sat)",
      "Last week (Mon - Sun)",
      "Last business week (Mon - Fri)",
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
    { date: "2026-08-30", jobs: 1, canceled: 0, done: 1, sales: 10.1, profit: 5 }, // Sunday
    { date: "2026-09-05", jobs: 2, canceled: 1, done: 1, sales: 20.2, profit: 8 }, // Saturday
    { date: "2026-09-06", jobs: 1, canceled: 0, done: 0, sales: 0, profit: 0 }, // next Sunday
  ];

  it("keeps days as they are", () => {
    expect(groupSeries(days, "day")).toEqual(days);
  });

  it("sums Sunday-started weeks and calendar months, keyed by their first day, to the cent", () => {
    expect(groupSeries(days, "week")).toEqual([
      { date: "2026-08-30", jobs: 3, canceled: 1, done: 2, sales: 30.3, profit: 13 },
      { date: "2026-09-06", jobs: 1, canceled: 0, done: 0, sales: 0, profit: 0 },
    ]);
    expect(groupSeries(days, "month").map((d) => d.date)).toEqual(["2026-08-01", "2026-09-01"]);
  });

  // Workiz live, This month 01–08.10.26 by week: 365 jobs (Oct 1–3) under
  // "09/30/2026" and 587 (Oct 4–8) under "10/07/2026" — MySQL's Sunday weeks.
  it("splits Workiz's October the way Workiz does", () => {
    const oct = [102, 141, 122, 94, 141, 122, 99, 131].map((jobs, i) => ({ date: `2026-10-0${i + 1}`, jobs, canceled: 0, done: 0 }));
    expect(groupSeries(oct, "week").map((w) => [w.date, w.jobs])).toEqual([
      ["2026-09-27", 365],
      ["2026-10-04", 587],
    ]);
  });

  // Workiz's series is a GROUP BY of the period's jobs: a day without a job
  // is no bar and no label, and a period without one is an empty chart.
  it("leaves out the days, weeks and months without a job, as Workiz's GROUP BY does", () => {
    const sparse = [
      { date: "2026-10-01", jobs: 2, canceled: 0, done: 1 },
      { date: "2026-10-02", jobs: 0, canceled: 0, done: 0 },
      { date: "2026-10-03", jobs: 1, canceled: 1, done: 0 },
    ];
    expect(groupSeries(sparse, "day").map((d) => d.date)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(groupSeries([{ date: "2026-10-02", jobs: 0, canceled: 0, done: 0 }], "week")).toEqual([]);
  });

  it("leaves the money out when the answer has none", () => {
    expect(groupSeries([{ date: "2026-09-01", jobs: 2, canceled: 1, done: 1 }], "month")).toEqual([
      { date: "2026-09-01", jobs: 2, canceled: 1, done: 1 },
    ]);
  });
});

describe("seriesLabel", () => {
  it("names a bar as Workiz does: the day, the week's Wednesday, the month", () => {
    expect(seriesLabel("2026-10-01", "day")).toBe("10/01/2026");
    expect(seriesLabel("2026-09-27", "week")).toBe("09/30/2026");
    expect(seriesLabel("2026-12-27", "week")).toBe("12/30/2026");
    expect(seriesLabel("2026-10-01", "month")).toBe("10/26");
  });
});

describe("Workiz's numbers", () => {
  it("prints a table figure with its thousands, the cents only when there are any", () => {
    expect(wzNumber(1745)).toBe("1,745");
    expect(wzNumber(325)).toBe("325");
    expect(wzNumber(0)).toBe("0");
    expect(wzNumber(46.7)).toBe("46.70");
    expect(wzNumber(1435.65)).toBe("1,435.65");
    expect(wzNumber(724691.3)).toBe("724,691.30");
    expect(wzNumber(-12.5)).toBe("-12.50");
    expect(wzNumber(undefined)).toBe("0");
  });

  it("prints a percent the same way", () => {
    expect(wzPercent(100)).toBe("100%");
    expect(wzPercent(44.9)).toBe("44.90%");
    expect(wzPercent(15.15)).toBe("15.15%");
    expect(wzPercent(0)).toBe("0%");
  });

  // An empty period's KPIs read "0" in Workiz (rep_jobstats_wz_15_empty_overview).
  it("prints the KPI money with cents always, a nothing as a bare 0", () => {
    expect(wzMoney(133524.6)).toBe("133,524.60");
    expect(wzMoney(12)).toBe("12.00");
    expect(wzMoney(0)).toBe("0");
    expect(wzMoney(undefined)).toBe("0");
  });

  it("prints a cell by its column, Totals' raw counts without a comma where Workiz has them", () => {
    expect(cellText(3935, "count")).toBe("3,935");
    expect(cellText(3935, "count", { bareCounts: true })).toBe("3935");
    expect(cellText(2713, "count", { bareCounts: true })).toBe("2713");
    expect(cellText(68.95, "pct")).toBe("68.95%");
    expect(cellText(724691.3, "money")).toBe("724,691.30");
    expect(cellText("SURE CT", "text")).toBe("SURE CT");
    expect(cellText(undefined, "text")).toBe("");
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

  it("spells blanks out — Workiz's own words where it has a row for them", () => {
    expect(rowName("tech", row("unassigned", "", 1, 0, 1, { techIds: [] }))).toBe("unassigned");
    expect(rowName("sources", row("ad:", "", 1, 0, 1, { kind: "ad" }))).toBe("unknown");
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

  // Workiz's pies (json.qty / json.dollar): a slice for every row with a Done
  // job, alphabetical like the table, coloured from its fixed 50-colour list.
  it("gives a pie a slice per row with a Done job, in name order, Workiz's colours", () => {
    const rows = [row("b", "B", 10, 3, 0, { gross: 30 }), row("z", "Z", 10, 0, 0, { gross: 0 }), row("a", "A", 10, 4, 0, { gross: 0 })];
    expect(pieSlices(rows, "done", (r) => r.label)).toEqual([
      { key: "a", name: "A", value: 4, color: "#FF6633" },
      { key: "b", name: "B", value: 3, color: "#FFB399" },
    ]);
    // By Sales Amount keeps a Done row whose amount is nothing, as Workiz does.
    expect(pieSlices(rows, "gross", (r) => r.label).map((s) => [s.name, s.value])).toEqual([
      ["A", 0],
      ["B", 30],
    ]);
    expect(pieSlices([row("x", "X", 1, 0, 1)], "done", (r) => r.label)).toEqual([]);
  });

  it("runs out of colours after fifty as Chart.js does, to its pale grey", () => {
    const many = Array.from({ length: 52 }, (_, i) => row(`r${i}`, `R${String(i).padStart(2, "0")}`, 1, 1, 0));
    const slices = pieSlices(many, "done", (r) => r.label);
    expect(slices[49].color).toBe("#6666FF");
    expect(slices[50].color).toBe("rgba(0,0,0,0.1)");
  });

  it("sorts like DataTables: a new column ascending, the same column flipped", () => {
    expect(nextSort(DEFAULT_SORT, "all")).toEqual({ key: "all", dir: "asc" });
    expect(nextSort({ key: "all", dir: "asc" }, "all")).toEqual({ key: "all", dir: "desc" });
    expect(nextSort({ key: "all", dir: "desc" }, "all")).toEqual({ key: "all", dir: "asc" });
    expect(nextSort(null, "name")).toEqual({ key: "name", dir: "asc" });
    expect(DEFAULT_SORT).toEqual({ key: "name", dir: "asc" });
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
