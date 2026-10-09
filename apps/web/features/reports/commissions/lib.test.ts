import { describe, expect, it } from "vitest";
import type { CommissionReportRow } from "@bitcrm/types";
import {
  COMMISSION_DATE_PRESETS,
  cellText,
  commissionColumns,
  commissionInfo,
  commissionReportParams,
  commissionTechOptions,
  formatDayTime,
  profitRows,
  rateLabel,
  todayIn,
  totalsCell,
  typeRows,
  visibleColumns,
  wzCellMoney,
  wzRawNumber,
  wzTotalNumber,
} from "./lib";
import { LEGACY_REPORT_PRESETS } from "../legacy-presets";

describe("the period list", () => {
  it("is the legacy pages' list (Workiz's Finance Reporting = Job Statistics; ranges in legacy-presets.test.ts)", () => {
    expect(COMMISSION_DATE_PRESETS).toBe(LEGACY_REPORT_PRESETS);
  });
});

describe("todayIn", () => {
  it("is the business's day, not UTC's", () => {
    expect(todayIn("America/New_York", new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
    expect(todayIn("UTC", new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-30");
  });
});

describe("commissionReportParams", () => {
  it("sends only what is set", () => {
    expect(
      commissionReportParams({ from: "2026-09-21", to: "2026-09-27", by: "closed", mode: "tech", techId: "t1", q: "  ", offset: 0, limit: 50 }),
    ).toEqual({ from: "2026-09-21", to: "2026-09-27", by: "closed", mode: "tech", techId: "t1", limit: "50" });
  });
});

describe("columns — Workiz's Fields lists, in its order, with its defaults (live 2026-10-09)", () => {
  const ids = (cols: { id: string }[]) => cols.map((c) => c.id);

  it("Standard: every field Workiz lists, none of the four “by external” ones", () => {
    expect(commissionColumns("standard").map((c) => c.label)).toEqual([
      "Job Id", "Tech", "Created", "Scheduled", "Closed", "Job Type", "Address", "Total", "Cash", "Credit", "Billing",
      "Check", "Tech Share", "Tip Amount", "Parts", "Company Parts", "Tech Profit", "External Company Profit",
      "Company Profit", "Tax", "Company Name", "Ad Group", "Client",
    ]);
    expect(ids(visibleColumns("standard", {}))).toEqual([
      "dealNumber", "techName", "scheduledDate", "closedDate", "jobTypeName", "address", "total", "cash", "credit",
      "billing", "check", "rate", "tip", "parts", "companyParts", "techProfit", "companyProfit", "tax", "clientName",
    ]);
  });

  it("Tech: Created and Balance Tech, no company profit; Scheduled and Client off", () => {
    expect(commissionColumns("tech").map((c) => c.label)).toEqual([
      "Job Id", "Tech", "Created", "Scheduled", "Closed", "Job Type", "Address", "Total", "Cash", "Credit", "Billing",
      "Check", "Tech Share", "Tip Amount", "Parts", "Company Parts", "Tech Profit", "Balance Tech", "Tax", "Client",
    ]);
    expect(ids(visibleColumns("tech", {}))).toEqual([
      "dealNumber", "techName", "createdAt", "closedDate", "jobTypeName", "address", "total", "cash", "credit", "billing",
      "check", "rate", "tip", "parts", "companyParts", "techProfit", "balance", "tax",
    ]);
  });

  it("External: no technician columns; the company's profit, its balance and its name", () => {
    expect(commissionColumns("external").map((c) => c.label)).toEqual([
      "Job Id", "Created", "Scheduled", "Closed", "Job Type", "Address", "Total", "Cash", "Credit", "Billing", "Check",
      "Parts", "Company Parts", "External Company Profit", "Balance", "Tax", "Company Name", "Client",
    ]);
    expect(ids(visibleColumns("external", {}))).not.toContain("clientName");
  });

  it("the viewer's Fields choice wins over the default", () => {
    const cols = ids(visibleColumns("standard", { clientName: false, tax: false, createdAt: true }));
    expect(cols).not.toContain("clientName");
    expect(cols).not.toContain("tax");
    expect(cols).toContain("createdAt");
  });

  it("without financials.view every amount and the rate are gone — from the table and from Fields", () => {
    expect(ids(visibleColumns("standard", {}, false))).toEqual([
      "dealNumber", "techName", "scheduledDate", "closedDate", "jobTypeName", "address", "clientName",
    ]);
    expect(ids(commissionColumns("tech", false))).toEqual([
      "dealNumber", "techName", "createdAt", "scheduledDate", "closedDate", "jobTypeName", "address", "clientName",
    ]);
    expect(ids(visibleColumns("external", { total: true }, false))).not.toContain("total");
  });
});

describe("cells — as Workiz prints them", () => {
  const row = {
    dealNumber: "TGQ6NS",
    rate: 50,
    rateUnit: "%",
    createdAt: "2026-09-24T19:06:16.000Z",
    closedDate: "2026-09-02",
    closedTime: "19:00",
    scheduledDate: "2026-09-02",
    scheduledTimeSlot: "18:00-19:00",
    total: 5802,
    techProfit: 48.63,
    companyProfit: -0.59,
    tip: 157.5,
    cashByExternal: 210,
    address: "215 Main St , 06851",
  } as unknown as CommissionReportRow;

  it("a rate: 50%, 37.5%, 165$, 1840.68$", () => {
    expect(rateLabel(row)).toBe("50%");
    expect(rateLabel({ rate: 37.5, rateUnit: "%" })).toBe("37.5%");
    expect(rateLabel({ rate: 165, rateUnit: "$" })).toBe("165$");
    expect(rateLabel({ rate: 1840.68, rateUnit: "$" })).toBe("1840.68$");
    expect(rateLabel({})).toBe("");
  });

  it("days: MM/DD/YYYY hh:mm AM, Created on the business's clock", () => {
    expect(formatDayTime("2026-09-02", "19:00")).toBe("09/02/2026 07:00 PM");
    expect(formatDayTime("2026-09-02", "00:30")).toBe("09/02/2026 12:30 AM");
    expect(cellText(row, "closedDate")).toBe("09/02/2026 07:00 PM");
    expect(cellText(row, "scheduledDate")).toBe("09/02/2026 06:00 PM");
    expect(cellText(row, "createdAt")).toBe("09/24/2026 03:06 PM");
  });

  it("money: thousands, two decimals unless whole; empty text is empty", () => {
    expect(cellText(row, "total")).toBe("5,802");
    expect(cellText(row, "techProfit")).toBe("48.63");
    expect(cellText(row, "companyProfit")).toBe("-0.59");
    expect(cellText(row, "tip")).toBe("157.50");
    expect(cellText(row, "externalBalance")).toBe("-210");
    expect(cellText(row, "clientName")).toBe("");
    expect(cellText(row, "address")).toBe("215 Main St , 06851");
  });

  it.each([
    [5802, "5,802"],
    [202.5, "202.50"],
    [1381.01, "1,381.01"],
    [0, "0"],
    [-0.59, "-0.59"],
    [12474.8, "12,474.80"],
  ])("cell %s → %s", (n, text) => {
    expect(wzCellMoney(n)).toBe(text);
  });

  it.each([
    [115533.77, "115533.77"],
    [2000, "2000"],
    [0, "0"],
    [417.7, "417.70"],
    [-14450.06, "-14450.06"],
  ])("Totals row %s → %s (no thousands, toFixed only when fractional)", (n, text) => {
    expect(wzTotalNumber(n)).toBe(text);
  });

  it("the summaries print the number as it is", () => {
    expect(wzRawNumber(22282.61)).toBe("22282.61");
    expect(wzRawNumber(0)).toBe("0");
    expect(wzRawNumber(157.5)).toBe("157.5");
  });
});

describe("the Totals row and the summaries", () => {
  const keys = [
    "total", "cash", "credit", "billing", "check", "tip", "parts", "companyParts", "techProfit", "externalCompanyProfit",
    "companyProfit", "tax", "cashByExternal", "creditByExternal", "billingByExternal", "checkByExternal", "balance",
  ];
  const amounts: Record<string, number> = { total: 115533.77, cashByExternal: 14450.06, check: 2000 };
  const totals = Object.fromEntries(keys.map((k) => [k, { amount: amounts[k] ?? 0, jobs: k === "total" ? 244 : 0 }])) as never;
  const std = (id: string) => commissionColumns("standard").find((c) => c.id === id)!;
  const ext = (id: string) => commissionColumns("external").find((c) => c.id === id)!;

  it("“Totals:N” first, the sums under the money columns, nothing under the rest", () => {
    expect(totalsCell({ count: 244, totals }, std("dealNumber"), 0)).toBe("Totals:244");
    expect(totalsCell({ count: 244, totals }, std("total"), 6)).toBe("115533.77");
    expect(totalsCell({ count: 244, totals }, std("check"), 10)).toBe("2000");
    expect(totalsCell({ count: 244, totals }, std("rate"), 11)).toBe("");
    expect(totalsCell({ count: 244, totals }, std("address"), 5)).toBe("");
    expect(totalsCell({ count: 244, totals }, ext("externalBalance"), 14)).toBe("-14450.06");
  });

  it("an empty period has “Totals:0” and blank sums", () => {
    expect(totalsCell({ count: 0, totals }, std("dealNumber"), 0)).toBe("Totals:0");
    expect(totalsCell({ count: 0, totals }, std("total"), 6)).toBe("");
  });

  it("Total Profits per mode, Total by type always the eight — none at all for an empty period", () => {
    expect(profitRows("standard", 1).map((r) => r.label)).toEqual(["external company profit", "company profit", "tech profit"]);
    expect(profitRows("tech", 1).map((r) => r.label)).toEqual(["tech profit"]);
    expect(profitRows("external", 1).map((r) => r.label)).toEqual(["external company profit"]);
    expect(profitRows("standard", 0)).toEqual([]);
    expect(typeRows(1).map((r) => r.label)).toEqual([
      "cash", "credit", "billing", "check", "cash by external", "credit by external", "billing by external", "check by external",
    ]);
    expect(typeRows(0)).toEqual([]);
  });
});

describe("commissionInfo — DataTables' line under the grid", () => {
  it.each([
    [1, 50, 244, "Showing 1 to 50 of 244 entries (filtered from 50 total entries)"],
    [5, 50, 244, "Showing 201 to 244 of 244 entries (filtered from 44 total entries)"],
    [1, 50, 19, "Showing 1 to 19 of 19 entries"],
    [1, 50, 1073, "Showing 1 to 50 of 1,073 entries (filtered from 50 total entries)"],
    [1, 50, 0, "Showing 0 to 0 of 0 entries"],
  ])("page %s × %s of %s", (page, size, count, text) => {
    // Workiz's server answers the page's own row count as the "total", so DataTables adds the clause whenever there are more pages.
    expect(commissionInfo(page, size, count)).toBe(text);
  });
});

describe("commissionTechOptions — every user, with “[N]” after those with jobs", () => {
  it("lists the account's people by name, counts from the report, and keeps a technician the directory lacks", () => {
    const users = [
      { id: "u2", firstName: "Bill", lastName: "Ryan", workizName: "(2) CT - Bill Ryan" },
      { id: "u1", firstName: "Ann", lastName: "Dispatcher", workizName: "(1) (Ann) 15 Dispatcher" },
      { id: "u3", firstName: "Zed", lastName: "Quiet" },
    ];
    const techs = [
      { techId: "u2", techName: "(2) CT - Bill Ryan", jobs: 14 },
      { techId: "gone", techName: "Old Tech", jobs: 2 },
    ];
    expect(commissionTechOptions(users as never, techs as never)).toEqual([
      { value: "u1", label: "(1) (Ann) 15 Dispatcher" },
      { value: "u2", label: "(2) CT - Bill Ryan   [14]" },
      { value: "gone", label: "Old Tech   [2]" },
      { value: "u3", label: "Zed Quiet" },
    ]);
  });
});
