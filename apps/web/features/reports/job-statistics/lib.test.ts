import { describe, expect, it } from "vitest";
import type { DealStatsBucket, DealStatsDay } from "@bitcrm/types";
import {
  breakdownCsv,
  breakdownRows,
  breakdownTotals,
  groupSeries,
  sortRows,
  statsParams,
} from "./lib";

describe("statsParams", () => {
  it("puts the window on the date the report is by, with only the filters that are set", () => {
    expect(statsParams({ by: "closed", from: "2026-09-01", to: "2026-09-25" })).toEqual({
      closedFrom: "2026-09-01",
      closedTo: "2026-09-25",
    });
    expect(
      statsParams({ by: "scheduled", from: "2026-09-01", to: "2026-09-30", serviceArea: "North", tagIds: ["a", "b"] }),
    ).toEqual({ scheduledFrom: "2026-09-01", scheduledTo: "2026-09-30", serviceArea: "North", tagIds: "a,b" });
    expect(statsParams({ by: "created", from: "2026-09-01", to: "2026-09-01", tagIds: [] })).toEqual({
      createdFrom: "2026-09-01",
      createdTo: "2026-09-01",
    });
  });
});

describe("groupSeries", () => {
  const days: DealStatsDay[] = [
    { date: "2026-08-31", jobs: 1, canceled: 0, revenue: 10, profit: 5 }, // Monday
    { date: "2026-09-01", jobs: 2, canceled: 1, revenue: 20, profit: 8 },
    { date: "2026-09-07", jobs: 1, canceled: 0, revenue: 5, profit: 1 }, // next Monday
  ];

  it("keeps days as they are", () => {
    expect(groupSeries(days, "day")).toEqual(days);
  });

  it("sums Monday-started weeks and calendar months, keyed by their first day", () => {
    expect(groupSeries(days, "week")).toEqual([
      { date: "2026-08-31", jobs: 3, canceled: 1, revenue: 30, profit: 13 },
      { date: "2026-09-07", jobs: 1, canceled: 0, revenue: 5, profit: 1 },
    ]);
    expect(groupSeries(days, "month")).toEqual([
      { date: "2026-08-01", jobs: 1, canceled: 0, revenue: 10, profit: 5 },
      { date: "2026-09-01", jobs: 3, canceled: 1, revenue: 25, profit: 9 },
    ]);
  });

  it("leaves the money out when the days carry none", () => {
    expect(groupSeries([{ date: "2026-09-01", jobs: 1, canceled: 0 }], "month")).toEqual([
      { date: "2026-09-01", jobs: 1, canceled: 0 },
    ]);
  });
});

const buckets: DealStatsBucket[] = [
  { key: "t1", all: 4, done: 2, open: 1, canceled: 1, revenue: 300, profit: 120 },
  { key: "t2", all: 1, done: 0, open: 1, canceled: 0, revenue: 0, profit: 0 },
];

describe("breakdownRows / breakdownTotals", () => {
  it("names each group and works out canceled %, average sale and profit per Done job", () => {
    const rows = breakdownRows(buckets, { t1: "Ann Lee" });
    expect(rows[0]).toEqual({
      key: "t1", name: "Ann Lee", all: 4, done: 2, open: 1, canceled: 1, canceledPct: 25,
      gross: 300, profit: 120, avgSale: 150, avgProfit: 60,
    });
    expect(rows[1]).toMatchObject({ name: "t2", canceledPct: 0, avgSale: 0, avgProfit: 0 });
  });

  it("totals the columns and recomputes the ratios over the totals", () => {
    const totals = breakdownTotals(breakdownRows(buckets, {}));
    expect(totals).toEqual({
      all: 5, done: 2, open: 2, canceled: 1, canceledPct: 20, gross: 300, profit: 120, avgSale: 150, avgProfit: 60,
    });
  });

  it("carries no money when the buckets have none", () => {
    const rows = breakdownRows([{ key: "t1", all: 1, done: 1, open: 0, canceled: 0 }], {});
    expect(rows[0].gross).toBeUndefined();
    expect(breakdownTotals(rows).gross).toBeUndefined();
  });
});

describe("sortRows", () => {
  it("sorts by any column either way, names alphabetically", () => {
    const rows = breakdownRows(
      [
        { key: "a", all: 1, done: 1, open: 0, canceled: 0, revenue: 50, profit: 1 },
        { key: "b", all: 3, done: 1, open: 2, canceled: 0, revenue: 10, profit: 1 },
      ],
      { a: "Zed", b: "Amy" },
    );
    expect(sortRows(rows, "all", "desc").map((r) => r.key)).toEqual(["b", "a"]);
    expect(sortRows(rows, "gross", "desc").map((r) => r.key)).toEqual(["a", "b"]);
    expect(sortRows(rows, "name", "asc").map((r) => r.key)).toEqual(["b", "a"]);
  });
});

describe("breakdownCsv", () => {
  it("writes the table with its totals row, money only when there is money", () => {
    const rows = breakdownRows(buckets, { t1: "Ann, Lee" });
    const csv = breakdownCsv("Tech", rows, breakdownTotals(rows));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Tech,All Jobs,Done Jobs,Open Jobs,Canceled Jobs,Canceled %,Gross Amount,Profit,Average Sale,Average Profit");
    expect(lines[1]).toBe('"Ann, Lee",4,2,1,1,25,300.00,120.00,150.00,60.00');
    expect(lines.at(-1)).toBe("Totals,5,2,2,1,20,300.00,120.00,150.00,60.00");

    const blind = breakdownRows([{ key: "t1", all: 1, done: 1, open: 0, canceled: 0 }], {});
    expect(breakdownCsv("Tech", blind, breakdownTotals(blind)).split("\n")[0]).toBe(
      "Tech,All Jobs,Done Jobs,Open Jobs,Canceled Jobs,Canceled %",
    );
  });
});
