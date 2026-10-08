import { describe, expect, it } from "vitest";
import type { Deal } from "@bitcrm/types";
import { comingUp, fromNow, visitStart, visitStreet } from "./coming-up";

const deal = (id: string, scheduledDate?: string, scheduledTimeSlot?: string, extra: Partial<Deal> = {}) =>
  ({
    id,
    scheduledDate,
    scheduledTimeSlot,
    contactId: `c-${id}`,
    address: { street: "271 Dunham St", city: "Southington", state: "Connecticut", zip: "06489" },
    ...extra,
  }) as Deal;

/** Workiz's "7 hours ago" / "in 2 hours" — moment's fromNow, which Workiz prints on the widget. */
describe("fromNow", () => {
  const h = 3_600_000;
  it.each([
    [-7 * h, "7 hours ago"],
    [2 * h, "in 2 hours"],
    [-30_000, "a few seconds ago"],
    [-60_000, "a minute ago"],
    [-10 * 60_000, "10 minutes ago"],
    [-60 * 60_000, "an hour ago"],
    [-23 * h, "a day ago"],
    [3 * 24 * h, "in 3 days"],
    [-30 * 24 * h, "a month ago"],
    [-400 * 24 * h, "a year ago"],
  ])("%d ms reads %s", (delta, words) => {
    expect(fromNow(delta)).toBe(words);
  });
});

describe("visitStart", () => {
  it("reads the visit's start on the account's clock (New York)", () => {
    // 10:15 EDT on Oct 8 is 14:15 UTC.
    expect(visitStart(deal("a", "2026-10-08", "10:15-11:00"))).toBe(Date.parse("2026-10-08T14:15:00Z"));
  });

  it("puts an all-day visit at the start of its day", () => {
    expect(visitStart(deal("a", "2026-10-08", undefined, { allDay: true }))).toBe(Date.parse("2026-10-08T04:00:00Z"));
  });

  it("has none for an undated job", () => {
    expect(visitStart(deal("a"))).toBeUndefined();
  });
});

describe("visitStreet", () => {
  it("is street, city and state with spaces, as Workiz prints it", () => {
    expect(visitStreet(deal("a", "2026-10-08"))).toBe("271 Dunham St Southington Connecticut");
  });

  it("skips what is missing", () => {
    expect(visitStreet(deal("a", "2026-10-08", undefined, { address: { street: "", city: "Waterbury", state: "CT", zip: "" } }))).toBe(
      "Waterbury CT",
    );
  });
});

describe("comingUp", () => {
  it("merges the open statuses' pages by visit start and keeps the first four", () => {
    const pages = [
      [deal("s1", "2026-10-08", "13:00-14:00"), deal("s2", "2026-10-09", "09:00-10:00")],
      [deal("p1", "2026-10-08", "10:15-11:00"), deal("p2", "2026-10-10", "08:00-09:00")],
      [deal("i1", "2026-10-08", "11:30-12:00")],
    ];
    expect(comingUp(pages).map((d) => d.id)).toEqual(["p1", "i1", "s1", "s2"]);
  });

  it("drops undated jobs and the same job read twice", () => {
    const pages = [[deal("a", "2026-10-08", "09:00-10:00"), deal("b")], [deal("a", "2026-10-08", "09:00-10:00")]];
    expect(comingUp(pages).map((d) => d.id)).toEqual(["a"]);
  });
});
