import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ITEMS_PRESET,
  ITEMS_FILTER_CHIP_ORDER,
  ITEMS_REPORT_PAGE_SIZES,
  ITEMS_REPORT_PRESETS,
  itemJobsParams,
  itemSubline,
  itemsCustomCheck,
  itemsExportParams,
  itemsFilterGroups,
  itemsPager,
  itemsPresetRange,
  itemsReportParams,
  marginText,
  money,
  nextSort,
  servicePlanText,
  totalUnitsText,
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
  // react-table (rep_items_wz_15_sort_*): the first click on any header sorts
  // it ascending (Units → qty asc, Item → description asc), the next turns it round.
  it("a header click flips its own column; another starts ascending, figures too", () => {
    expect(nextSort({ column: "number", dir: "desc" }, "number")).toEqual({ column: "number", dir: "asc" });
    expect(nextSort({ column: "number", dir: "desc" }, "item")).toEqual({ column: "item", dir: "asc" });
    expect(nextSort({ column: "number", dir: "desc" }, "units")).toEqual({ column: "units", dir: "asc" });
    expect(nextSort({ column: "units", dir: "asc" }, "units")).toEqual({ column: "units", dir: "desc" });
    expect(nextSort({ column: "item", dir: "desc" }, "price")).toEqual({ column: "price", dir: "asc" });
  });
});

describe("Items and services — cells", () => {
  // Workiz's qty strings: "1.00", "1382.00" — two places, no separators.
  it("prints units with two decimals and no separators — never Workiz's float (6597.849999999999)", () => {
    expect(unitsText(6597.85)).toBe("6597.85");
    expect(unitsText(1382)).toBe("1382.00");
    expect(unitsText(3.1)).toBe("3.10");
  });

  // An empty report's Total (rep_items_wz_17c_two_chips): Units blank, money $0.00.
  it("leaves the Total's units blank when no item is listed", () => {
    expect(totalUnitsText({ items: 0, units: 0 })).toBe("");
    expect(totalUnitsText({ items: 147, units: 1400.6 })).toBe("1400.60");
  });

  it("money, margin and the grey line under the name", () => {
    expect(money(631162.95)).toBe("$631,162.95");
    expect(money(-97.19)).toBe("-$97.19");
    expect(money(undefined)).toBe("");
    expect(marginText(45.43)).toBe("45.43% margin");
    expect(marginText(0)).toBe("0.00% margin");
    expect(itemSubline({ number: 17011, type: "product" })).toBe("#17011 - product");
    expect(itemSubline({ type: "service" })).toBe("service");
  });

  // Workiz sends margin 0 (an integer) for every row whose profit is not above
  // zero — 101 of 101 such rows in five windows, a negative price included.
  it("prints 0% margin for a row that made no profit", () => {
    expect(marginText(-50.85, -908.9)).toBe("0% margin");
    expect(marginText(100, -1723.23)).toBe("0% margin");
    expect(marginText(0, -110.09)).toBe("0% margin");
    expect(marginText(60.25, 150.63)).toBe("60.25% margin");
    expect(marginText(undefined, 5)).toBe("");
  });

  it("prints the job's service plan as Workiz does — the word true or false", () => {
    expect(servicePlanText(false)).toBe("false");
    expect(servicePlanText(true)).toBe("true");
  });
});

describe("Items and services — date box", () => {
  // rep_items_wz_16g_custom_over_year: Workiz refuses a Custom range over 12 months in the box, and asks nothing.
  it("refuses a Custom range longer than twelve months; a preset is always fine", () => {
    expect(itemsCustomCheck({ preset: "custom", from: "2025-05-15", to: "2026-10-09" })).toEqual({ usable: false, error: "Date range exceeds 12 months" });
    expect(itemsCustomCheck({ preset: "custom", from: "2025-10-09", to: "2026-10-09" })).toEqual({ usable: true, error: null });
    expect(itemsCustomCheck({ preset: "last_year", from: "2025-01-01", to: "2025-12-31" })).toEqual({ usable: true, error: null });
  });
});

describe("Items and services — filter", () => {
  const groups = itemsFilterGroups({
    jobTypes: [{ id: "jt1", name: "Lockout" }],
    categories: ["Locks & Cylinders", "Door Hardware"],
    periodCategories: ["Door Hardware", "Old Category"],
    people: [
      { id: "u2", name: "Ann Office" },
      { id: "u1", name: "(2) IL - Daniel Szender" },
    ],
    periodSellers: [{ id: "u3", name: "Gone Seller" }, { id: "u1", name: "Daniel Szender" }],
  });

  // Workiz's four groups in its order, each chip keyed as its filters object is.
  it("offers ITEM TYPE, JOB TYPE, CATEGORY, SOLD BY with Workiz's chip keys", () => {
    expect(groups.map((g) => [g.key, g.label, g.chip])).toEqual([
      ["type", "Item Type", "type"],
      ["jobTypeId", "Job type", "jobType"],
      ["category", "Category", "category"],
      ["soldBy", "Sold By", "sold_by"],
    ]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Product", "Service", "Hours", "Expense", "Equipment", "Warranty"]);
    expect(groups[1].options).toEqual([{ value: "jt1", label: "Lockout" }]);
  });

  it("lists every category of the price book, then any the period has that the book lost; by name", () => {
    expect(groups[2].options.map((o) => o.value)).toEqual(["Locks & Cylinders", "Door Hardware", "Old Category"]);
  });

  it("lists everyone who could have sold, by name, then sellers of the period the directory lacks", () => {
    expect(groups[3].options).toEqual([
      { value: "u1", label: "(2) IL - Daniel Szender" },
      { value: "u2", label: "Ann Office" },
      { value: "u3", label: "Gone Seller" },
    ]);
  });

  it("lists chips in Workiz's filters order: type, jobType, sold_by, category", () => {
    expect(ITEMS_FILTER_CHIP_ORDER).toEqual(["type", "jobTypeId", "soldBy", "category"]);
  });
});

describe("Items and services — pager", () => {
  it("reads the server's page into Workiz's footer: items counted, not the Total row", () => {
    const go = vi.fn();
    const p = itemsPager({ page: 2, pageSize: 10, total: 147, pages: 15, from: 11, to: 20 }, go, false);
    expect(p).toMatchObject({ page: 2, from: 11, to: 20, total: 147, totalPages: 15, canPrev: true, canNext: true, isFetching: false });
    p.prev();
    expect(go).toHaveBeenLastCalledWith(1);
    void p.next();
    expect(go).toHaveBeenLastCalledWith(3);
  });

  it("an empty report is page 1 of 1 with nowhere to go", () => {
    const p = itemsPager({ page: 1, pageSize: 50, total: 0, pages: 0, from: 0, to: 0 }, vi.fn(), false);
    expect(p).toMatchObject({ from: 0, to: 0, total: 0, totalPages: 1, canPrev: false, canNext: false });
  });
});
