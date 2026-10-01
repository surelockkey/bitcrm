import { describe, expect, it } from "vitest";
import {
  SALES_FIELDS,
  addSalesFilter,
  chartDayLabel,
  inSalesOrder,
  marginLabel,
  nextSalesSort,
  salesExportParams,
  salesReportParams,
  type SalesReportState,
} from "./lib";

const state: SalesReportState = {
  by: "scheduled",
  from: "2026-09-01",
  to: "2026-09-30",
  filters: { status: ["done"], paymentStatus: ["paid", "due"] },
  search: "  Guzman ",
  sort: "jobNumber",
  dir: "desc",
  page: 2,
  pageSize: 10,
};

describe("Sales report — web lib", () => {
  it("builds the page query: period, By, filters, search, sort, paging", () => {
    expect(Object.fromEntries(new URLSearchParams(salesReportParams(state)))).toEqual({
      by: "scheduled",
      from: "2026-09-01",
      to: "2026-09-30",
      status: "done",
      paymentStatus: "paid,due",
      q: "Guzman",
      sort: "jobNumber",
      dir: "desc",
      page: "2",
      pageSize: "10",
    });
  });

  it("the export sends the same query with its columns and no paging", () => {
    const p = Object.fromEntries(new URLSearchParams(salesExportParams(state, ["jobNumber", "total"])));
    expect(p.columns).toBe("jobNumber,total");
    expect(p.page).toBeUndefined();
    expect(p.status).toBe("done");
  });

  it("keeps the columns in Workiz's fixed order", () => {
    expect(inSalesOrder(["profit", "jobNumber", "client"])).toEqual(["jobNumber", "client", "profit"]);
    expect(SALES_FIELDS.filter((f) => f.money).map((f) => f.id)).toEqual([
      "total", "subtotal", "itemCost", "laborCost", "cardExpenses", "techExpenses", "paid", "due", "tax", "profit", "tip",
    ]);
  });

  it("a header click flips the same column; a new one starts newest / largest first, text A→Z", () => {
    expect(nextSalesSort({ column: "jobNumber", dir: "desc" }, "jobNumber")).toEqual({ column: "jobNumber", dir: "asc" });
    expect(nextSalesSort({ column: "jobNumber", dir: "desc" }, "total")).toEqual({ column: "total", dir: "desc" });
    expect(nextSalesSort({ column: "jobNumber", dir: "desc" }, "client")).toEqual({ column: "client", dir: "asc" });
  });

  it("a status clicked in a cell is added once", () => {
    const f = addSalesFilter({}, "status", "done");
    expect(addSalesFilter(f, "status", "done")).toBe(f);
    expect(f).toEqual({ status: ["done"] });
  });

  it("prints the chart day and the margin as Workiz does", () => {
    expect(chartDayLabel("2026-09-01")).toBe("09/01/26");
    expect(marginLabel(80.58)).toBe("80.58% margin");
    expect(marginLabel(100)).toBe("100% margin");
    expect(marginLabel(undefined)).toBe("");
  });
});
