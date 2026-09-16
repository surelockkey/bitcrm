import { describe, expect, it } from "vitest";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import {
  addressLine,
  compareVisitOrder,
  filterStockRows,
  formatClock,
  formatDayHeading,
  formatSlot,
  groupJobsByDay,
  localDateIso,
  navigationUrl,
  shiftDateIso,
  sortStockRows,
  techActionState,
} from "./lib";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: over.id ?? "d1",
    dealNumber: over.dealNumber ?? "A1B2C3",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "CT",
    address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" },
    jobTypeId: "jt1",
    superStatus: JobSuperStatus.IN_PROGRESS,
    assignedTechIds: ["t1"],
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const TODAY = "2026-09-16";

describe("dates", () => {
  it("formats the local day as YYYY-MM-DD", () => {
    expect(localDateIso(new Date(2026, 8, 16, 23, 30))).toBe("2026-09-16");
  });

  it("shifts a day across a month boundary", () => {
    expect(shiftDateIso("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDateIso("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("formats 24h clocks as 12h", () => {
    expect(formatClock("09:00")).toBe("9:00 AM");
    expect(formatClock("12:30")).toBe("12:30 PM");
    expect(formatClock("00:15")).toBe("12:15 AM");
    expect(formatClock("garbage")).toBe("garbage");
  });

  it("formats a slot, an all-day job and a missing time", () => {
    expect(formatSlot("09:00-12:00", false)).toBe("9:00 AM – 12:00 PM");
    expect(formatSlot("09:00-09:00", false)).toBe("9:00 AM");
    expect(formatSlot("09:00-12:00", true)).toBe("All day");
    expect(formatSlot(undefined, false)).toBe("No time");
  });

  it("labels a later day with its weekday", () => {
    expect(formatDayHeading("2026-09-23")).toBe("Wed, Sep 23");
  });
});

describe("groupJobsByDay", () => {
  it("puts still-open earlier jobs first, then today, tomorrow, later days, unscheduled", () => {
    const groups = groupJobsByDay(
      [
        deal({ id: "later", scheduledDate: "2026-09-23", scheduledTimeSlot: "09:00-10:00" }),
        deal({ id: "today", scheduledDate: TODAY, scheduledTimeSlot: "09:00-10:00" }),
        deal({ id: "tomorrow", scheduledDate: "2026-09-17" }),
        deal({ id: "overdue", scheduledDate: "2026-09-10", superStatus: JobSuperStatus.SUBMITTED }),
        deal({ id: "nodate" }),
      ],
      TODAY,
      "t1",
    );
    expect(groups.map((g) => g.key)).toEqual(["overdue", "today", "tomorrow", "day:2026-09-23", "unscheduled"]);
    expect(groups.map((g) => g.label)).toEqual([
      "Still open from earlier",
      "Today",
      "Tomorrow",
      "Wed, Sep 23",
      "Not scheduled yet",
    ]);
    expect(groups[1].deals.map((d) => d.id)).toEqual(["today"]);
  });

  it("always shows Today, even when empty", () => {
    const groups = groupJobsByDay([], TODAY);
    expect(groups).toEqual([{ key: "today", label: "Today", dateIso: TODAY, deals: [] }]);
  });

  it("drops finished jobs from earlier days but keeps today's", () => {
    const groups = groupJobsByDay(
      [
        deal({ id: "old-done", scheduledDate: "2026-09-10", superStatus: JobSuperStatus.DONE }),
        deal({ id: "old-canceled", scheduledDate: "2026-09-10", superStatus: JobSuperStatus.CANCELED }),
        deal({ id: "today-done", scheduledDate: TODAY, superStatus: JobSuperStatus.DONE }),
        deal({ id: "nodate-done", superStatus: JobSuperStatus.DONE }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.key)).toEqual(["today"]);
    expect(groups[0].deals.map((d) => d.id)).toEqual(["today-done"]);
  });

  it("drops finished jobs from future days too — a canceled job is no stop on Tuesday", () => {
    const groups = groupJobsByDay(
      [
        deal({
          id: "tomorrow-canceled",
          scheduledDate: "2026-09-17",
          superStatus: JobSuperStatus.CANCELED,
        }),
        deal({ id: "later-done", scheduledDate: "2026-09-23", superStatus: JobSuperStatus.DONE }),
        deal({ id: "later-open", scheduledDate: "2026-09-23", superStatus: JobSuperStatus.SUBMITTED }),
      ],
      TODAY,
    );

    // Tomorrow held nothing but a canceled job, so it gets no heading at all.
    expect(groups.map((g) => g.key)).toEqual(["today", "day:2026-09-23"]);
    expect(groups[1].deals.map((d) => d.id)).toEqual(["later-open"]);
  });

  it("orders a day by the technician's route position, then slot start", () => {
    const groups = groupJobsByDay(
      [
        deal({ id: "b", dealNumber: "B", scheduledDate: TODAY, scheduledTimeSlot: "08:00-09:00" }),
        deal({ id: "a", dealNumber: "A", scheduledDate: TODAY, scheduledTimeSlot: "13:00-14:00", sequences: { t1: 1 } }),
        deal({ id: "c", dealNumber: "C", scheduledDate: TODAY, scheduledTimeSlot: "10:00-11:00", sequences: { t1: 2 } }),
        deal({ id: "d", dealNumber: "D", scheduledDate: TODAY }),
      ],
      TODAY,
      "t1",
    );
    expect(groups[0].deals.map((d) => d.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("ignores another technician's route positions", () => {
    const a = deal({ id: "a", scheduledTimeSlot: "13:00-14:00", sequences: { other: 1 } });
    const b = deal({ id: "b", scheduledTimeSlot: "08:00-09:00" });
    expect(compareVisitOrder(a, b, "t1")).toBeGreaterThan(0);
  });
});

describe("address", () => {
  it("renders one line, skipping empty parts", () => {
    expect(addressLine({ street: "1 Main St", unit: "Apt 2", city: "Hartford", state: "CT", zip: "06103" })).toBe(
      "1 Main St, Apt 2, Hartford, CT 06103",
    );
    expect(addressLine({ street: "", city: "", state: "", zip: "" })).toBe("");
    expect(addressLine(undefined)).toBe("");
  });

  it("navigates by coordinates when geocoded, by text otherwise", () => {
    expect(navigationUrl({ street: "1 Main St", city: "Hartford", state: "CT", zip: "06103", lat: 41.76, lng: -72.67 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=41.76%2C-72.67",
    );
    expect(navigationUrl({ street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St%2C%20Hartford%2C%20CT%2006103",
    );
    expect(navigationUrl({ street: "", city: "", state: "", zip: "" })).toBeNull();
  });
});

describe("techActionState", () => {
  it("offers the whole flow on a fresh Submitted job", () => {
    expect(techActionState({ superStatus: JobSuperStatus.SUBMITTED })).toEqual({
      canConfirm: true,
      canNotify: true,
      canArrive: true,
      canStart: true,
      canFinish: false,
    });
  });

  it("hides confirm and arrived once they have happened, and offers Done while in progress", () => {
    expect(
      techActionState({ superStatus: JobSuperStatus.IN_PROGRESS, techConfirmedAt: "x", arrivedAt: "y" }),
    ).toEqual({ canConfirm: false, canNotify: true, canArrive: false, canStart: false, canFinish: true });
  });

  it("offers nothing on a closed job", () => {
    expect(techActionState({ superStatus: JobSuperStatus.DONE })).toEqual({
      canConfirm: false,
      canNotify: false,
      canArrive: false,
      canStart: false,
      canFinish: false,
    });
  });
});

describe("stock search", () => {
  const rows = [
    { productId: "p1", name: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 2, isLow: true },
    { productId: "p2", name: "Key blank", sku: "KEY-1", category: "Keys", quantity: 120, isLow: false },
    { productId: "p3", name: "Cylinder", category: "Locks", quantity: 8, isLow: false },
  ];

  it("returns everything for an empty query", () => {
    expect(filterStockRows(rows, "  ")).toHaveLength(3);
  });

  it("matches on name, SKU or category, case-insensitively", () => {
    expect(filterStockRows(rows, "dead").map((r) => r.productId)).toEqual(["p1"]);
    expect(filterStockRows(rows, "key-1").map((r) => r.productId)).toEqual(["p2"]);
    expect(filterStockRows(rows, "LOCKS").map((r) => r.productId)).toEqual(["p1", "p3"]);
  });

  it("requires every word, but lets them come from different fields", () => {
    expect(filterStockRows(rows, "locks dead").map((r) => r.productId)).toEqual(["p1"]);
    expect(filterStockRows(rows, "locks nothing")).toEqual([]);
  });

  it("ignores a row with no SKU rather than throwing", () => {
    expect(filterStockRows(rows, "cylinder").map((r) => r.productId)).toEqual(["p3"]);
  });

  it("floats low stock to the top, then sorts by name", () => {
    expect(sortStockRows(rows).map((r) => r.productId)).toEqual(["p1", "p3", "p2"]);
  });

  it("does not mutate the list it was given", () => {
    const original = [...rows];
    sortStockRows(rows);
    expect(rows).toEqual(original);
  });
});
