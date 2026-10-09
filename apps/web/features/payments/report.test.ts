import { describe, expect, it } from "vitest";
import { wzFilterChips } from "@/components/workiz/grouped-filter";
import {
  DEFAULT_PAYMENTS_REPORT_PRESET,
  PAYMENTS_REPORT_PRESETS,
  PAYMENT_DATE_PRESETS,
  buildPaymentReportQuery,
  businessToday,
  customRangeError,
  paymentCellMoney,
  paymentDay,
  paymentFilterGroups,
  paymentPresetRange,
  paymentTotalMoney,
  paymentsRangeText,
  paymentsReportQuery,
  paymentsReportRange,
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

describe("Payments report — the date box (Workiz's 20 presets, rep_payments_wz_06_date_open)", () => {
  // Friday, 9 October 2026.
  const FRI = "2026-10-09";

  it("lists Workiz's presets in its order and words, opening on This month", () => {
    expect(PAYMENTS_REPORT_PRESETS.map((p) => p.label)).toEqual([
      "Custom",
      "Today",
      "Yesterday",
      "Last 7 days",
      "Last 14 days",
      "Last 30 days",
      "Last month",
      "This month",
      "This year",
      "Last year",
      "This week (Sun-Today)",
      "This week (Mon-Today)",
      "Last week (Sun-Sat)",
      "Last week (Mon-Sun)",
      "Last business week (Mon-Fri)",
      "Last 3 months",
      "Last six months",
      "Last twelve months",
      "All time",
      "Recent (30 days, including today)",
    ]);
    expect(DEFAULT_PAYMENTS_REPORT_PRESET).toBe("this_month");
  });

  it.each([
    // The Jobs report's presets, shared: "Last N days" include today.
    ["today", "2026-10-09", "2026-10-09"],
    ["last_7", "2026-10-03", "2026-10-09"],
    ["this_month", "2026-10-01", "2026-10-09"],
    ["last_month", "2026-09-01", "2026-09-30"],
    ["last_week_mon", "2026-09-28", "2026-10-04"],
    // Workiz's datepicker: N full months before this one.
    ["last_3_months", "2026-07-01", "2026-09-30"],
    ["last_6_months", "2026-04-01", "2026-09-30"],
    ["last_12_months", "2025-10-01", "2026-09-30"],
    // "Recent (30 days, including today)" is subtract(30, "days") … today: 31 days.
    ["recent", "2026-09-09", "2026-10-09"],
  ] as const)("%s → %s … %s", (preset, from, to) => {
    expect(paymentsReportRange(preset, FRI)).toEqual({ from, to });
  });

  it("All time has no days: the box says so and the query carries none", () => {
    const range = paymentsReportRange("all_time", FRI);
    expect(range).toEqual({ from: "", to: "" });
    expect(paymentsRangeText({ preset: "all_time", ...range })).toBe("All time");
    expect(paymentsRangeText({ preset: "this_month", from: "2026-10-01", to: "2026-10-09" })).toBe(
      "Oct 1st, 2026 - Oct 9th, 2026",
    );
    expect(paymentsReportQuery({ range: { preset: "all_time", ...range }, filters: {}, search: "", dir: "desc", limit: 10 })).toEqual({
      dir: "desc",
      limit: 10,
    });
  });

  it("turns the box, the filter and the search into the report's query", () => {
    expect(
      paymentsReportQuery({
        range: { preset: "last_month", from: "2026-09-01", to: "2026-09-30" },
        filters: { types: ["refund"], serviceAreaIds: [], technicianIds: ["t1"] },
        search: "  6563K8 ",
        dir: "asc",
        limit: 25,
      }),
    ).toEqual({ from: "2026-09-01", to: "2026-09-30", types: ["refund"], technicianIds: ["t1"], search: "6563K8", dir: "asc", limit: 25 });
  });
});

describe("Payments report — Filter results (rep_payments_wz_05_filter_open, _17c_chip_tech)", () => {
  const groups = paymentFilterGroups(
    [
      { id: "a2", name: "SURE LOCK TX", color: "#7fffd4" },
      { id: "a0", name: "All areas" },
      { id: "a3", name: "Platinum_AL", color: "#b8860b" },
      { id: "a4", name: "PLATINUM ALL STATES" },
      { id: "a1", name: "North Carolina" },
    ],
    // The caller's order (Workiz's: who joined the team first).
    [
      { id: "t1", name: "(1) YAKOV SZENDER" },
      { id: "t2", name: "(2) CT - Tyler Boucher" },
      { id: "t3", name: "(1) Harry EM" },
    ],
  );

  it("has Workiz's three groups: types in Workiz's order, areas A→Z without All areas, techs as given", () => {
    expect(groups.map((g) => g.label)).toEqual(["Payment type", "Service Areas", "Technician"]);
    expect(groups[0].options.map((o) => o.label)).toEqual([
      "Credit charge",
      "Credit offline",
      "Check deposit",
      "Check",
      "Cash",
      "Bank transfer (offline)",
      "Cash app",
      "Consumer financing",
      "Venmo",
      "Zelle",
      "Debit offline",
      "Bank transfer (ACH)",
      "Installments",
      "Refund",
      "Other",
    ]);
    // rep_payments_wz_05_filter_open: North Carolina, PLATINUM ALL STATES, Platinum_AL… — no "All areas".
    expect(groups[1].options).toEqual([
      { value: "a1", label: "North Carolina" },
      { value: "a4", label: "PLATINUM ALL STATES" },
      { value: "a3", label: "Platinum_AL", color: "#b8860b" },
      { value: "a2", label: "SURE LOCK TX", color: "#7fffd4" },
    ]);
    expect(groups[2].options.map((o) => o.label)).toEqual(["(1) YAKOV SZENDER", "(2) CT - Tyler Boucher", "(1) Harry EM"]);
  });

  it("names the chips as Workiz does: the type alone, metro: and technician: before the others", () => {
    expect(
      wzFilterChips(groups, { types: ["cash"], serviceAreaIds: ["a2"], technicianIds: ["t2"] }).map((c) => c.label),
    ).toEqual(["Cash", "metro: SURE LOCK TX", "technician: (2) CT - Tyler Boucher"]);
  });

  it("leaves out a group with nothing to offer", () => {
    expect(paymentFilterGroups([], []).map((g) => g.label)).toEqual(["Payment type"]);
  });

  it("builds the query string with comma lists and no empty values", () => {
    expect(
      buildPaymentReportQuery({ from: "2026-09-01", to: "2026-09-27", types: ["charge", "cash"], search: " ", limit: 10, dir: "desc" }),
    ).toBe("?from=2026-09-01&to=2026-09-27&types=charge%2Ccash&dir=desc&limit=10");
    expect(buildPaymentReportQuery({})).toBe("");
  });
});

describe("Payments report — the cells (bundle: columns Amount / Tip / Payment date)", () => {
  it("puts only a refund in parentheses; any other negative keeps its minus", () => {
    expect(paymentCellMoney(1064.44, "charge")).toBe("$1,064.44");
    expect(paymentCellMoney(-85.74, "refund")).toBe("($85.74)");
    expect(paymentCellMoney(-30, "refund_offline")).toBe("($30.00)");
    expect(paymentCellMoney(0, "refund")).toBe("($0.00)");
    // rep_payments_wz_15_sort_amount: a negative Credit offline reads "-$207.00".
    expect(paymentCellMoney(-207, "credit")).toBe("-$207.00");
  });

  it("prints a card's total with a minus, never in parentheses", () => {
    expect(paymentTotalMoney(130302.8)).toBe("$130,302.80");
    expect(paymentTotalMoney(-1149.4)).toBe("-$1,149.40");
    expect(paymentTotalMoney(0)).toBe("$0.00");
  });

  it("writes the payment's day as Workiz's buildDate does, on the account's clock", () => {
    expect(paymentDay("2026-10-08T22:22:25.000Z")).toBe("Thu, Oct 8, 2026");
    // 01:28 UTC on Sep 28 is still Sep 27 in New York.
    expect(paymentDay("2026-09-28T01:28:36.000Z")).toBe("Sun, Sep 27, 2026");
    expect(paymentDay("not a date")).toBe("");
  });
});
