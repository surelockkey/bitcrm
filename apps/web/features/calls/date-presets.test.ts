import { describe, expect, it } from "vitest";
import { CALLS_PRESETS, callsPresetRange, dayRangeToInstants } from "./date-presets";

/**
 * The call log's date box, as Workiz has it on Thu 2026-10-08
 * (callspage_wz_date_presets.json): the same list as its reports, and like
 * them the "Last N days" end TODAY.
 */
const TODAY = "2026-10-08";

describe("CALLS_PRESETS", () => {
  it("lists Workiz's fifteen, in its order", () => {
    expect(CALLS_PRESETS).toEqual([
      "custom",
      "today",
      "yesterday",
      "last_7",
      "last_14",
      "last_30",
      "last_month",
      "this_month",
      "this_year",
      "last_year",
      "this_week_sun",
      "this_week_mon",
      "last_week_sun",
      "last_week_mon",
      "last_business_week",
    ]);
  });
});

describe("callsPresetRange", () => {
  it.each([
    ["today", "2026-10-08", "2026-10-08"],
    ["yesterday", "2026-10-07", "2026-10-07"],
    ["last_7", "2026-10-02", "2026-10-08"],
    ["last_14", "2026-09-25", "2026-10-08"],
    ["last_30", "2026-09-09", "2026-10-08"],
    ["last_month", "2026-09-01", "2026-09-30"],
    ["this_month", "2026-10-01", "2026-10-08"],
    ["this_year", "2026-01-01", "2026-10-08"],
    ["last_year", "2025-01-01", "2025-12-31"],
    ["this_week_sun", "2026-10-04", "2026-10-08"],
    ["this_week_mon", "2026-10-05", "2026-10-08"],
    ["last_week_sun", "2026-09-27", "2026-10-03"],
    ["last_week_mon", "2026-09-28", "2026-10-04"],
    ["last_business_week", "2026-09-28", "2026-10-02"],
  ] as const)("%s → %s .. %s", (preset, from, to) => {
    expect(callsPresetRange(preset, TODAY)).toEqual({ from, to });
  });

  it("leaves Custom to the page", () => {
    expect(callsPresetRange("custom", TODAY)).toBeNull();
  });
});

describe("dayRangeToInstants", () => {
  it("turns account days into the instants the call log is filtered by", () => {
    // New York is on EDT (UTC−4) in October.
    expect(dayRangeToInstants({ from: "2026-10-08", to: "2026-10-08" })).toEqual({
      dateFrom: "2026-10-08T04:00:00.000Z",
      dateTo: "2026-10-09T03:59:59.999Z",
    });
  });

  it("follows the clock change inside the window", () => {
    // DST ends on 2026-11-01: the window opens on EDT and closes on EST.
    expect(dayRangeToInstants({ from: "2026-10-31", to: "2026-11-01" })).toEqual({
      dateFrom: "2026-10-31T04:00:00.000Z",
      dateTo: "2026-11-02T04:59:59.999Z",
    });
  });
});
