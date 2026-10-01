import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEMS_PRESET,
  ITEMS_REPORT_PAGE_SIZES,
  ITEMS_REPORT_PRESETS,
  itemJobsParams,
  itemSubline,
  itemsExportParams,
  itemsPresetRange,
  itemsReportParams,
  marginText,
  money,
  nextSort,
  toggleItemsFilter,
  unitsText,
  type ItemsReportState,
} from "./lib";

const state = (over: Partial<ItemsReportState> = {}): ItemsReportState => ({
  from: "2026-09-01",
  to: "2026-09-27",
  filters: {},
  search: "",
  sort: "number",
  dir: "desc",
  page: 1,
  pageSize: 50,
  ...over,
});

describe("Items and services — presets", () => {
  it("offers Workiz's list for this report: the standard fifteen and Last 3 months, This month by default", () => {
    expect(ITEMS_REPORT_PRESETS.map((p) => p.label)).toContain("Last 3 months");
    expect(ITEMS_REPORT_PRESETS.map((p) => p.label)).not.toContain("All time");
    expect(ITEMS_REPORT_PRESETS).toHaveLength(16);
    expect(DEFAULT_ITEMS_PRESET).toBe("this_month");
  });

  it.each([
    ["this_month", "2026-09-01", "2026-09-30"],
    ["last_month", "2026-08-01", "2026-08-31"],
    ["last_3_months", "2026-06-01", "2026-08-31"],
    ["last_year", "2025-01-01", "2025-12-31"],
  ] as const)("%s on 2026-09-30 → %s … %s", (preset, from, to) => {
    expect(itemsPresetRange(preset, "2026-09-30")).toEqual({ from, to });
  });

  it("Last 3 months crosses the year in January", () => {
    expect(itemsPresetRange("last_3_months", "2027-01-15")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("pages of 5 … 100, as Workiz", () => {
    expect([...ITEMS_REPORT_PAGE_SIZES]).toEqual([5, 10, 20, 25, 50, 100]);
  });
});

describe("Items and services — requests", () => {
  it("the page: window, sort, paging", () => {
    expect(Object.fromEntries(new URLSearchParams(itemsReportParams(state())))).toEqual({
      from: "2026-09-01",
      to: "2026-09-27",
      sort: "number",
      dir: "desc",
      page: "1",
      pageSize: "50",
    });
  });

  it("filters: ids joined, each category its own parameter (a name may hold a comma); the search trimmed", () => {
    const p = new URLSearchParams(
      itemsReportParams(state({ filters: { type: ["product", "service"], category: ["Locks, Keys", "Safes"], soldBy: ["u1"] }, search: " lock " })),
    );
    expect(p.get("type")).toBe("product,service");
    expect(p.getAll("category")).toEqual(["Locks, Keys", "Safes"]);
    expect(p.get("soldBy")).toBe("u1");
    expect(p.get("q")).toBe("lock");
  });

  it("the export: the same query without paging; an item's jobs: the item and its own page", () => {
    const e = new URLSearchParams(itemsExportParams(state({ page: 3 })));
    expect(e.get("page")).toBeNull();
    expect(e.get("sort")).toBe("number");
    const j = new URLSearchParams(itemJobsParams(state({ filters: { jobTypeId: ["jt1"] } }), "p-1", 2, 50));
    expect(j.get("item")).toBe("p-1");
    expect(j.get("page")).toBe("2");
    expect(j.get("jobTypeId")).toBe("jt1");
  });
});

describe("Items and services — toolbar", () => {
  it("ticks and unticks a value; an emptied group goes", () => {
    const one = toggleItemsFilter({}, "type", "product");
    expect(one).toEqual({ type: ["product"] });
    expect(toggleItemsFilter(one, "type", "product")).toEqual({});
  });

  it("a header click flips its own column; another opens text A→Z and figures high→low", () => {
    expect(nextSort({ column: "number", dir: "desc" }, "number")).toEqual({ column: "number", dir: "asc" });
    expect(nextSort({ column: "number", dir: "desc" }, "item")).toEqual({ column: "item", dir: "asc" });
    expect(nextSort({ column: "item", dir: "asc" }, "units")).toEqual({ column: "units", dir: "desc" });
  });
});

describe("Items and services — cells", () => {
  it("prints units with two decimals — never Workiz's float (6597.849999999999)", () => {
    expect(unitsText(6597.85)).toBe("6,597.85");
    expect(unitsText(3.1)).toBe("3.10");
  });

  it("money, margin and the grey line under the name", () => {
    expect(money(631162.95)).toBe("$631,162.95");
    expect(money(undefined)).toBe("");
    expect(marginText(45.43)).toBe("45.43% margin");
    expect(itemSubline({ number: 17011, type: "product" })).toBe("#17011 - product");
    expect(itemSubline({ type: "service" })).toBe("service");
  });
});
