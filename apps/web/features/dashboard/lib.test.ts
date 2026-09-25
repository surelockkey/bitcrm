import { describe, expect, it } from "vitest";
import { bucketLabel, compactMoney, DEFAULT_PERIOD, periodWindow, statusRows } from "./lib";

describe("periodWindow", () => {
  const today = "2026-09-25";

  it("defaults to the last 30 days, today included (Workiz)", () => {
    expect(DEFAULT_PERIOD).toBe("last_30");
    expect(periodWindow("last_30", today)).toEqual({ from: "2026-08-27", to: "2026-09-25" });
  });

  it("covers the other presets, all inside the 92-day window the server takes", () => {
    expect(periodWindow("today", today)).toEqual({ from: today, to: today });
    expect(periodWindow("last_7", today)).toEqual({ from: "2026-09-19", to: today });
    expect(periodWindow("last_90", today)).toEqual({ from: "2026-06-28", to: today });
    expect(periodWindow("this_month", today)).toEqual({ from: "2026-09-01", to: today });
    expect(periodWindow("last_month", today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
});

describe("compactMoney", () => {
  it("keeps whole dollars below ten thousand and compacts above", () => {
    expect(compactMoney(0)).toBe("$0");
    expect(compactMoney(4250.4)).toBe("$4,250");
    expect(compactMoney(12_940)).toBe("$12.9K");
    expect(compactMoney(128_450)).toBe("$128K");
    expect(compactMoney(4_200_000)).toBe("$4.2M");
    expect(compactMoney(-1500)).toBe("-$1,500");
  });
});

describe("bucketLabel", () => {
  it("names a key from the lookup, falls back to the key, and calls an empty key Not set", () => {
    const names = { t1: "Ann Lee" };
    expect(bucketLabel("t1", names)).toBe("Ann Lee");
    expect(bucketLabel("North", names)).toBe("North");
    expect(bucketLabel("", names)).toBe("Not set");
  });
});

describe("statusRows", () => {
  it("lists the Workiz super-statuses in board order with their counts", () => {
    const rows = statusRows({
      submitted: 3, in_progress: 2, pending: 1, done_pending_approval: 0, done: 5, canceled: 1,
    });
    expect(rows.map((r) => [r.status, r.count])).toEqual([
      ["submitted", 3],
      ["in_progress", 2],
      ["done", 5],
      ["pending", 1],
      ["done_pending_approval", 0],
      ["canceled", 1],
    ]);
    expect(rows.every((r) => r.label.length > 0)).toBe(true);
  });
});
