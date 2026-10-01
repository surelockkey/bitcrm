import { describe, expect, it } from "vitest";
import {
  ESTIMATE_DATE_PRESETS,
  INVOICE_DATE_PRESETS,
  TAX_DATE_PRESETS,
  splitInvoiceFilters,
  toQuery,
  workizDate,
} from "./lib";

describe("billing report helpers", () => {
  it("offers each page Workiz's own presets", () => {
    const values = (xs: ReadonlyArray<{ value: string }>) => xs.map((x) => x.value);
    expect(values(INVOICE_DATE_PRESETS)).toContain("all_time");
    expect(values(ESTIMATE_DATE_PRESETS)).toContain("all_time");
    expect(values(ESTIMATE_DATE_PRESETS)).not.toContain("last_3_months");
    expect(values(ESTIMATE_DATE_PRESETS)).not.toContain("recent");
    expect(values(TAX_DATE_PRESETS)).not.toContain("all_time");
    expect(values(TAX_DATE_PRESETS)).toContain("this_month");
  });

  it("builds the query with comma lists and without empty values", () => {
    expect(toQuery({ from: "2026-09-01", statuses: ["due", "overdue"], sent: [], search: "", to: undefined })).toBe(
      "?from=2026-09-01&statuses=due%2Coverdue",
    );
    expect(toQuery({})).toBe("");
  });

  it("splits Filter results into the three groups", () => {
    expect(splitInvoiceFilters(["status:due", "days:0_30", "status:paid", "sent:unsent"])).toEqual({
      statuses: ["due", "paid"],
      daysDue: ["0_30"],
      sent: ["unsent"],
    });
    expect(splitInvoiceFilters([])).toEqual({});
  });

  it("prints dates the way Workiz does", () => {
    expect(workizDate("2019-07-16")).toBe("Tue Jul 16, 2019");
    expect(workizDate("2026-09-29T02:00:00.000Z")).toBe("Mon Sep 28, 2026");
    expect(workizDate(undefined)).toBe("");
  });
});
