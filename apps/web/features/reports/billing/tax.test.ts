import { describe, expect, it } from "vitest";
import type { TaxReportRow } from "@bitcrm/types";
import {
  DEFAULT_TAX_REPORT_PRESET,
  TAX_DEFAULT_SORT,
  TAX_REPORT_PRESETS,
  defaultTaxParams,
  orderTaxRows,
  taxColumnIds,
  taxColumnLabel,
  taxFilterOptions,
  taxKpi,
  taxRateText,
  taxReportParams,
} from "./tax";

const row = (name: string, amount: number, jobs: number, rate = 6.35): TaxReportRow => ({
  key: `${name}|${rate}`,
  name,
  description: "",
  rate,
  ratePercent: rate,
  amount,
  taxableAmount: amount * 10,
  nonTaxableAmount: 0,
  jobs,
});

// Workiz's Accrual, This month 2026-10-01..09 (rep_tax_wz_01_default / net1).
const OCT = [
  row("SURE NY", 3.99, 1, 8.88),
  row("CT", 4386.01, 135),
  row("AL Jefferson", 79, 2, 10),
  row("SURE LOCK TX", 3815.75, 79, 8.25),
  row("IL CHICAGO", 254.71, 4, 10.25),
];
const names = (rows: TaxReportRow[]) => rows.map((r) => r.name);

describe("Tax report presets", () => {
  it("are Workiz's twenty in Workiz's words, without All time (the deal service windows ≤ 12 months)", () => {
    const labels = TAX_REPORT_PRESETS.map((p) => p.label);
    expect(labels).toHaveLength(19);
    expect(labels).toContain("This week (Sun-Today)");
    expect(labels).toContain("Recent (30 days, including today)");
    expect(labels).not.toContain("All time");
    expect(labels[0]).toBe("Custom");
    expect(DEFAULT_TAX_REPORT_PRESET).toBe("this_month");
  });
});

describe("taxKpi", () => {
  it("is Workiz's one sentence over the grid, per tab", () => {
    expect(taxKpi("accrual", 8539.46)).toBe("$8,539.46 total tax on sold items");
    expect(taxKpi("paid", 5132.71)).toBe("$5,132.71 total tax from collected payments");
  });

  it("reads $0.00 with nothing found (rep_tax_wz_11b_search_empty)", () => {
    expect(taxKpi("accrual", undefined)).toBe("$0.00 total tax on sold items");
    expect(taxKpi("accrual", 0)).toBe("$0.00 total tax on sold items");
  });
});

describe("taxRateText", () => {
  it("prints two places and a percent sign", () => {
    expect(taxRateText(10)).toBe("10.00%");
    expect(taxRateText(8.88)).toBe("8.88%");
    expect(taxRateText(6.35)).toBe("6.35%");
  });
});

describe("taxColumnIds / taxColumnLabel", () => {
  it("Accrual: seven columns with Non-Taxable Amount", () => {
    expect(taxColumnIds("accrual").map((id) => taxColumnLabel(id, "accrual"))).toEqual([
      "Name",
      "Description",
      "Rate",
      "Amount",
      "Taxable Amount",
      "Non-Taxable Amount",
      "Jobs",
    ]);
  });

  it("Paid: six, the amount headed Tax and no Non-Taxable", () => {
    expect(taxColumnIds("paid").map((id) => taxColumnLabel(id, "paid"))).toEqual([
      "Name",
      "Description",
      "Rate",
      "Tax",
      "Taxable Amount",
      "Jobs",
    ]);
  });
});

describe("orderTaxRows", () => {
  it("opens with the bar under Name (desc), Accrual A→Z and Paid Z→A, as Workiz", () => {
    expect(TAX_DEFAULT_SORT).toEqual({ column: "name", dir: "desc" });
    expect(names(orderTaxRows(OCT, TAX_DEFAULT_SORT, "accrual"))).toEqual(["AL Jefferson", "CT", "IL CHICAGO", "SURE LOCK TX", "SURE NY"]);
    expect(names(orderTaxRows(OCT, TAX_DEFAULT_SORT, "paid"))).toEqual(["SURE NY", "SURE LOCK TX", "IL CHICAGO", "CT", "AL Jefferson"]);
  });

  it("Accrual sorts backwards, as Workiz's server does: Amount asc → the largest first (rep_tax_wz_10_sort_amount_1)", () => {
    expect(names(orderTaxRows(OCT, { column: "amount", dir: "asc" }, "accrual"))).toEqual(["CT", "SURE LOCK TX", "IL CHICAGO", "AL Jefferson", "SURE NY"]);
    expect(names(orderTaxRows(OCT, { column: "amount", dir: "desc" }, "accrual"))).toEqual(["SURE NY", "AL Jefferson", "IL CHICAGO", "SURE LOCK TX", "CT"]);
    expect(names(orderTaxRows(OCT, { column: "jobs", dir: "asc" }, "accrual"))).toEqual(["CT", "SURE LOCK TX", "IL CHICAGO", "AL Jefferson", "SURE NY"]);
    expect(names(orderTaxRows(OCT, { column: "name", dir: "asc" }, "accrual"))).toEqual(["SURE NY", "SURE LOCK TX", "IL CHICAGO", "CT", "AL Jefferson"]);
  });

  it("Paid sorts the way the bar says (rep_tax_wz_16_paid_sort_tax_1)", () => {
    const paid = [row("SURE LOCK TX", 2511.39, 59, 8.25), row("IL CHICAGO", 15.66, 1, 10.25), row("CT", 2411.6, 120), row("AL Jefferson", 194.06, 1, 10)];
    expect(names(orderTaxRows(paid, { column: "amount", dir: "asc" }, "paid"))).toEqual(["IL CHICAGO", "AL Jefferson", "CT", "SURE LOCK TX"]);
    expect(names(orderTaxRows(paid, { column: "amount", dir: "desc" }, "paid"))).toEqual(["SURE LOCK TX", "CT", "AL Jefferson", "IL CHICAGO"]);
    expect(names(orderTaxRows(paid, { column: "name", dir: "asc" }, "paid"))).toEqual(["AL Jefferson", "CT", "IL CHICAGO", "SURE LOCK TX"]);
  });

  it("keeps two rates of one name apart by their rate, and leaves the input alone", () => {
    const rows = [row("AZ", 1, 1, 8.6), row("AZ", 2, 1, 5.6)];
    expect(orderTaxRows(rows, TAX_DEFAULT_SORT, "accrual").map((r) => r.rate)).toEqual([5.6, 8.6]);
    expect(rows.map((r) => r.rate)).toEqual([8.6, 5.6]);
  });
});

describe("taxFilterOptions", () => {
  it("is All taxes, then every tax by its name alone (Workiz's labels)", () => {
    expect(
      taxFilterOptions([
        { key: "AZ|5.6", name: "AZ", rate: 5.6 },
        { key: "AZ|8.6", name: "AZ", rate: 8.6 },
        { key: "CT|6.35", name: "CT", rate: 6.35 },
      ]),
    ).toEqual([
      { value: "0", label: "All taxes" },
      { value: "AZ|5.6", label: "AZ" },
      { value: "AZ|8.6", label: "AZ" },
      { value: "CT|6.35", label: "CT" },
    ]);
  });
});

describe("taxReportParams", () => {
  const range = { preset: "this_month", from: "2026-10-01", to: "2026-10-09" };

  it("asks Accrual by its By:, all taxes, no search", () => {
    expect(taxReportParams({ basis: "accrual", by: "end", range, tax: "0", search: "  " })).toEqual({
      basis: "accrual",
      by: "end",
      from: "2026-10-01",
      to: "2026-10-09",
    });
  });

  it("asks Paid without a By:, with the chosen tax and the search", () => {
    expect(taxReportParams({ basis: "paid", by: "created", range, tax: "CT|6.35", search: " ct " })).toEqual({
      basis: "paid",
      from: "2026-10-01",
      to: "2026-10-09",
      tax: "CT|6.35",
      search: "ct",
    });
  });

  it("is what a tab opens on — This month, Job end date — so both can be fetched up front", () => {
    expect(defaultTaxParams("accrual", "2026-10-09")).toEqual({ basis: "accrual", by: "end", from: "2026-10-01", to: "2026-10-09" });
    expect(defaultTaxParams("paid", "2026-10-09")).toEqual({ basis: "paid", from: "2026-10-01", to: "2026-10-09" });
  });
});
