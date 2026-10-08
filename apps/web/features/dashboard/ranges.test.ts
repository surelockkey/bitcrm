import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET, INVOICE_RANGES, WIDGET_RANGES, rangeWindowOf } from "./ranges";

/** Workiz Home's range picker (main.js `eEl`): four ranges, the 14 days first chosen; Invoices adds All time. */
describe("dashboard ranges", () => {
  it("offers Workiz's four ranges, worded as Workiz words them", () => {
    expect(WIDGET_RANGES.map((r) => r.label)).toEqual([
      "This week (Mon-Today)",
      "Last 14 days",
      "This month",
      "Last 3 months",
    ]);
    expect(DEFAULT_PRESET).toBe("last_14_days");
  });

  it("gives Invoices an All time at the end", () => {
    expect(INVOICE_RANGES.map((r) => r.value)).toEqual([
      "this_week",
      "last_14_days",
      "this_month",
      "last_three",
      "all_time",
    ]);
    expect(INVOICE_RANGES.at(-1)?.label).toBe("All time");
  });

  it("turns a range into days on the account's calendar, and All time into none", () => {
    const thu = new Date("2026-10-08T15:00:00Z");
    expect(rangeWindowOf("this_week", thu)).toEqual({ from: "2026-10-05", to: "2026-10-08" });
    expect(rangeWindowOf("last_14_days", thu)).toEqual({ from: "2026-09-24", to: "2026-10-08" });
    expect(rangeWindowOf("all_time", thu)).toBeUndefined();
  });
});

// The server refuses a window over 92 days; no range may run into that, any day of the year.
describe("every range fits the server's 92 days", () => {
  it.each(["this_week", "last_14_days", "this_month", "last_three"] as const)("%s", (range) => {
    for (let d = 0; d < 400; d += 3) {
      const now = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000 + 15 * 3_600_000);
      const { from, to } = rangeWindowOf(range, now)!;
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(92);
    }
  });
});
