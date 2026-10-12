import { describe, expect, it } from "vitest";
import {
  ESTIMATE_DATE_PRESETS,
  INVOICE_DATE_PRESETS,
  splitInvoiceFilters,
  toQuery,
  workizDate,
  workizDateTime,
} from "./lib";

describe("billing report helpers", () => {
  it("offers each page Workiz's own presets", () => {
    const values = (xs: ReadonlyArray<{ value: string }>) => xs.map((x) => x.value);
    expect(values(INVOICE_DATE_PRESETS)).toContain("all_time");
    expect(values(ESTIMATE_DATE_PRESETS)).toContain("all_time");
    expect(values(ESTIMATE_DATE_PRESETS)).not.toContain("last_3_months");
    expect(values(ESTIMATE_DATE_PRESETS)).not.toContain("recent");
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

  /**
   * 2026-10-12 owner: every time on the web is Connecticut's clock and says
   * so — an unlabelled "09:34 am" was read as Kyiv time.
   */
  it("prints a moment on Connecticut's clock with its zone — EDT in summer, EST in winter", () => {
    expect(workizDateTime("2026-09-11T07:39:00.000Z")).toBe("Fri Sep 11, 2026 03:39 am EDT");
    expect(workizDateTime("2026-12-01T15:00:00.000Z")).toBe("Tue Dec 01, 2026 10:00 am EST");
    // 03:30Z on Oct 13 is still Oct 12 in Connecticut.
    expect(workizDateTime("2026-10-13T03:30:00.000Z")).toBe("Mon Oct 12, 2026 11:30 pm EDT");
    expect(workizDateTime(undefined)).toBe("");
  });
});
