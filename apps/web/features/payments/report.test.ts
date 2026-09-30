import { describe, expect, it } from "vitest";
import {
  PAYMENT_DATE_PRESETS,
  buildPaymentReportQuery,
  businessToday,
  customRangeError,
  paymentPresetRange,
  reportDateTime,
  reportFilterGroups,
  reportMoney,
  splitFilters,
} from "./report";

// Wednesday, 30 September 2026.
const TODAY = "2026-09-30";

describe("Payments report — date presets (Workiz)", () => {
  it("offers Workiz's 19 presets plus Custom, opening on This month", () => {
    expect(PAYMENT_DATE_PRESETS).toHaveLength(20);
    expect(PAYMENT_DATE_PRESETS[0].value).toBe("custom");
    expect(PAYMENT_DATE_PRESETS.map((p) => p.label)).toContain("Recent (30 days)");
  });

  it.each([
    ["today", "2026-09-30", "2026-09-30"],
    ["yesterday", "2026-09-29", "2026-09-29"],
    ["last_7_days", "2026-09-24", "2026-09-30"],
    ["last_14_days", "2026-09-17", "2026-09-30"],
    ["last_30_days", "2026-09-01", "2026-09-30"],
    ["this_month", "2026-09-01", "2026-09-30"],
    ["last_month", "2026-08-01", "2026-08-31"],
    ["this_year", "2026-01-01", "2026-09-30"],
    ["last_year", "2025-01-01", "2025-12-31"],
    ["this_week_sun", "2026-09-27", "2026-09-30"],
    ["this_week_mon", "2026-09-28", "2026-09-30"],
    ["last_week_sun", "2026-09-20", "2026-09-26"],
    ["last_week_mon", "2026-09-21", "2026-09-27"],
    ["last_business_week", "2026-09-21", "2026-09-25"],
    // "Last N months" = N FULL months, the current one not included.
    ["last_3_months", "2026-06-01", "2026-08-31"],
    ["last_6_months", "2026-03-01", "2026-08-31"],
    ["last_12_months", "2025-09-01", "2026-08-31"],
  ] as const)("%s → %s … %s", (preset, from, to) => {
    expect(paymentPresetRange(preset, TODAY)).toEqual({ from, to });
  });

  it("All time is open at both ends — the server spans what it has", () => {
    expect(paymentPresetRange("all_time", TODAY)).toEqual({});
  });

  it("January's Last month and Last 3 months cross the year", () => {
    expect(paymentPresetRange("last_month", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(paymentPresetRange("last_3_months", "2027-01-15")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("a Sunday's This week (Sun) is just that day", () => {
    expect(paymentPresetRange("this_week_sun", "2026-09-27")).toEqual({ from: "2026-09-27", to: "2026-09-27" });
    expect(paymentPresetRange("this_week_mon", "2026-09-27")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("Custom: both ends, in order, at most 12 months", () => {
    expect(customRangeError("2026-09-01", "2026-09-30")).toBeNull();
    expect(customRangeError("2025-10-01", "2026-09-30")).toBeNull();
    expect(customRangeError("2025-09-01", "2026-09-30")).toMatch(/12 months/);
    expect(customRangeError("2026-09-30", "2026-09-01")).toMatch(/after/);
    expect(customRangeError("", "2026-09-01")).toMatch(/both/);
  });

  it("today is the business's (Eastern) day, not the viewer's", () => {
    // 01:30 UTC on Oct 1 is still Sep 30 in New York.
    expect(businessToday(new Date("2026-10-01T01:30:00Z"))).toBe("2026-09-30");
  });
});

describe("Payments report — Filter results", () => {
  it("has Workiz's three groups, sorted inside", () => {
    const groups = reportFilterGroups(
      [
        { id: "a2", name: "SURE LOCK TX" },
        { id: "a1", name: "North Carolina" },
      ],
      [{ id: "t1", name: "Tom Tech" }],
    );
    expect(groups.map((g) => g.heading)).toEqual(["Payment type", "Service Areas", "Technician"]);
    expect(groups[0].options.map((o) => o.label).slice(0, 3)).toEqual(["Credit charge", "Credit offline", "Check deposit"]);
    expect(groups[1].options.map((o) => o.label)).toEqual(["North Carolina", "SURE LOCK TX"]);
  });

  it("splits the chosen options into the three query lists", () => {
    expect(splitFilters(["type:refund", "type:cash", "area:a1", "tech:t1"])).toEqual({
      types: ["refund", "cash"],
      serviceAreaIds: ["a1"],
      technicianIds: ["t1"],
    });
    expect(splitFilters([])).toEqual({});
  });

  it("builds the query string with comma lists and no empty values", () => {
    expect(
      buildPaymentReportQuery({ from: "2026-09-01", to: "2026-09-27", types: ["charge", "cash"], search: " ", limit: 10, dir: "desc" }),
    ).toBe("?from=2026-09-01&to=2026-09-27&types=charge%2Ccash&dir=desc&limit=10");
    expect(buildPaymentReportQuery({})).toBe("");
  });
});

describe("Payments report — formatting", () => {
  it("writes money going out in parentheses, as Workiz does", () => {
    expect(reportMoney(1064.44)).toBe("$1,064.44");
    expect(reportMoney(-85.74)).toBe("($85.74)");
  });

  it("shows the payment time on the business clock", () => {
    expect(reportDateTime("2026-09-28T01:28:36.000Z")).toBe("09/27/2026 9:28 PM");
  });
});
