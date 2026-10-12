import { describe, expect, it } from "vitest";
import type { Deal } from "@bitcrm/types";
import { comingUp, fromNow, visitStart, visitStreet, visitWhen } from "./coming-up";

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

  // It read every job's wall clock as New York's: a Texas visit came out an
  // hour early ("in 2 hours" for one three hours off).
  it("reads a visit on the clock of the zone it was booked in", () => {
    // 10:15 CDT on Oct 8 is 15:15 UTC; 09:00 CST on Dec 1 is 15:00 UTC.
    expect(visitStart(deal("a", "2026-10-08", "10:15-11:00"), "America/Chicago")).toBe(Date.parse("2026-10-08T15:15:00Z"));
    expect(visitStart(deal("a", "2026-12-01", "09:00-10:00"), "America/Chicago")).toBe(Date.parse("2026-12-01T15:00:00Z"));
  });
});

describe("visitWhen", () => {
  // Beside "in 2 hours": when that is, on Connecticut's clock, labelled (2026-10-12 owner rule).
  it("is the moment on Connecticut's clock with its zone", () => {
    expect(visitWhen(Date.parse("2026-10-08T15:15:00Z"))).toBe("Oct 8, 11:15 AM EDT");
    expect(visitWhen(Date.parse("2026-12-01T15:00:00Z"))).toBe("Dec 1, 10:00 AM EST");
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

  it("orders the visits by when they really start, each on its own zone's clock", () => {
    // Texas 10:00 CDT = 11:00 EDT: after Connecticut's 10:30.
    const tx = deal("tx", "2026-10-08", "10:00-11:00", { serviceAreaId: "sa-tx" });
    const ct = deal("ct", "2026-10-08", "10:30-11:30");
    const zoneOf = (d: Pick<Deal, "serviceAreaId">) => (d.serviceAreaId === "sa-tx" ? "America/Chicago" : "America/New_York");
    expect(comingUp([[tx, ct]], zoneOf).map((d) => d.id)).toEqual(["ct", "tx"]);
  });

  it("drops undated jobs and the same job read twice", () => {
    const pages = [[deal("a", "2026-10-08", "09:00-10:00"), deal("b")], [deal("a", "2026-10-08", "09:00-10:00")]];
    expect(comingUp(pages).map((d) => d.id)).toEqual(["a"]);
  });
});
