import { describe, expect, it } from "vitest";
import { blockedDay, canBlockNumber } from "./blocked-callers";

/**
 * Workiz Phone → Blocked callers. The grid's Created column prints the day a
 * number was blocked as `YYYY-MM-DD` on the business clock (New York), as
 * Workiz prints `2020-07-29` for a row created 2020-07-29T20:50:18Z.
 */
describe("blockedDay", () => {
  it("prints the New York day of the instant", () => {
    expect(blockedDay("2020-07-29T20:50:18.000Z")).toBe("2020-07-29");
    // 02:30 UTC is still the evening before in New York.
    expect(blockedDay("2026-10-10T02:30:00.000Z")).toBe("2026-10-09");
  });

  it("is blank for a row with no date (an import without one)", () => {
    expect(blockedDay("")).toBe("");
    expect(blockedDay(undefined)).toBe("");
  });
});

/**
 * "Block this number" is offered for an outside number only: not for our own
 * softphone legs, not for a withheld (masked) number, not when there is none.
 */
describe("canBlockNumber", () => {
  it("is a real outside number", () => {
    expect(canBlockNumber({ number: "+12147917112", kind: "unknown" })).toBe(true);
    expect(canBlockNumber({ number: "+12147917112", kind: "contact", name: "Jane" })).toBe(true);
  });

  it("is never one of ours, a masked one or a missing one", () => {
    expect(canBlockNumber({ number: "client:agent-1", kind: "user" })).toBe(false);
    expect(canBlockNumber({ number: "+14045550100", kind: "user", name: "Sam" })).toBe(false);
    expect(canBlockNumber({ number: undefined, kind: "unknown", masked: true })).toBe(false);
    expect(canBlockNumber({ number: undefined, kind: "unknown" })).toBe(false);
  });
});
