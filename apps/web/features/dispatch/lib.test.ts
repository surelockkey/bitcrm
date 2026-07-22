import { describe, expect, it } from "vitest";
import {
  ClientType,
  DealPriority,
  DealStage,
  DealStatus,
  type Deal,
  type TechnicianProfile,
} from "@bitcrm/types";
import {
  splitByLocation,
  technicianPositions,
  mergeLivePositions,
  technicianStatus,
  formatAge,
  techJobsToday,
  technicianAvailability,
  techJobProgress,
  isInTimeOrder,
  type TechnicianPosition,
} from "./lib";

const TODAY = "2026-07-14";

function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    dealNumber: 1,
    contactId: "contact-1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Atlanta Metro",
    address: {
      street: "1 Main St",
      city: "Atlanta",
      state: "GA",
      zip: "30303",
      lat: 33.749,
      lng: -84.388,
    },
    jobTypeId: "jt-lockout",
    stage: DealStage.NEW_LEAD,
    assignedDispatcherId: "dispatcher-1",
    priority: DealPriority.NORMAL,
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "dispatcher-1",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function tech(overrides: Partial<TechnicianProfile> = {}): TechnicianProfile {
  return {
    userId: "tech-1",
    homeAddress: {
      line1: "9 Home Rd",
      city: "Atlanta",
      state: "GA",
      zip: "30310",
      lat: 33.7,
      lng: -84.4,
    },
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as TechnicianProfile;
}

describe("splitByLocation", () => {
  it("separates deals that can be plotted from those that cannot", () => {
    const located = deal({ id: "a" });
    const unlocated = deal({
      id: "b",
      address: { street: "2 Nowhere", city: "Atlanta", state: "GA", zip: "30303" },
    });

    const { mapped, unmapped } = splitByLocation([located, unlocated]);

    expect(mapped.map((d) => d.id)).toEqual(["a"]);
    expect(unmapped.map((d) => d.id)).toEqual(["b"]);
  });

  // Silently dropping them would make the map look complete when it isn't.
  it("keeps unlocated deals rather than discarding them", () => {
    const deals = [
      deal({ id: "a" }),
      deal({ id: "b", address: { street: "x", city: "c", state: "s", zip: "z" } }),
    ];

    const { mapped, unmapped } = splitByLocation(deals);

    expect(mapped.length + unmapped.length).toBe(deals.length);
  });
});

/**
 * There is no GPS in the platform and none is planned in this phase
 * (`project-info/phase-1-features.md`). A technician's position is derived: the
 * address of their last job today, or their home if they have no jobs today.
 */
describe("technicianPositions", () => {
  it("puts a technician with no jobs today at their home", () => {
    const positions = technicianPositions([tech()], [], TODAY);

    expect(positions).toEqual([
      expect.objectContaining({ userId: "tech-1", lat: 33.7, lng: -84.4, source: "home" }),
    ]);
  });

  it("puts a technician at their last job of the day", () => {
    const deals = [
      deal({
        id: "morning",
        assignedTechId: "tech-1",
        scheduledDate: TODAY,
        scheduledTimeSlot: "09:00-12:00",
        address: { street: "AM", city: "Atlanta", state: "GA", zip: "1", lat: 1, lng: 1 },
      }),
      deal({
        id: "afternoon",
        assignedTechId: "tech-1",
        scheduledDate: TODAY,
        scheduledTimeSlot: "15:00-18:00",
        address: { street: "PM", city: "Atlanta", state: "GA", zip: "2", lat: 2, lng: 2 },
      }),
    ];

    const positions = technicianPositions([tech()], deals, TODAY);

    expect(positions[0]).toMatchObject({ lat: 2, lng: 2, source: "last_job" });
  });

  it("orders by time slot, not by array order", () => {
    const deals = [
      deal({
        id: "late",
        assignedTechId: "tech-1",
        scheduledDate: TODAY,
        scheduledTimeSlot: "15:00-18:00",
        address: { street: "PM", city: "A", state: "GA", zip: "2", lat: 2, lng: 2 },
      }),
      deal({
        id: "early",
        assignedTechId: "tech-1",
        scheduledDate: TODAY,
        scheduledTimeSlot: "09:00-12:00",
        address: { street: "AM", city: "A", state: "GA", zip: "1", lat: 1, lng: 1 },
      }),
    ];

    const positions = technicianPositions([tech()], deals, TODAY);

    expect(positions[0]).toMatchObject({ lat: 2, lng: 2 });
  });

  it("ignores jobs scheduled on another day", () => {
    const deals = [
      deal({
        assignedTechId: "tech-1",
        scheduledDate: "2026-07-01",
        scheduledTimeSlot: "09:00-12:00",
        address: { street: "old", city: "A", state: "GA", zip: "1", lat: 9, lng: 9 },
      }),
    ];

    const positions = technicianPositions([tech()], deals, TODAY);

    expect(positions[0]).toMatchObject({ lat: 33.7, source: "home" });
  });

  it("ignores another technician's jobs", () => {
    const deals = [
      deal({
        assignedTechId: "tech-2",
        scheduledDate: TODAY,
        scheduledTimeSlot: "09:00-12:00",
        address: { street: "theirs", city: "A", state: "GA", zip: "1", lat: 9, lng: 9 },
      }),
    ];

    const positions = technicianPositions([tech()], deals, TODAY);

    expect(positions[0]).toMatchObject({ source: "home" });
  });

  it("falls back to home when today's last job has no coordinates", () => {
    const deals = [
      deal({
        assignedTechId: "tech-1",
        scheduledDate: TODAY,
        scheduledTimeSlot: "09:00-12:00",
        address: { street: "unlocated", city: "A", state: "GA", zip: "1" },
      }),
    ];

    const positions = technicianPositions([tech()], deals, TODAY);

    expect(positions[0]).toMatchObject({ source: "home" });
  });

  // Nothing to place them by — a marker at 0,0 in the Atlantic would be a lie.
  it("omits a technician with neither jobs nor home coordinates", () => {
    const homeless = tech({
      userId: "tech-9",
      homeAddress: { line1: "?", city: "A", state: "GA", zip: "1" },
    });

    expect(technicianPositions([homeless], [], TODAY)).toEqual([]);
  });

  it("omits a technician with no home address at all", () => {
    expect(technicianPositions([tech({ homeAddress: undefined })], [], TODAY)).toEqual([]);
  });
});

const NOW = Date.parse("2026-07-14T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("mergeLivePositions", () => {
  const derived = [
    { userId: "tech-1", lat: 10, lng: 10, source: "home" as const },
    { userId: "tech-2", lat: 20, lng: 20, source: "last_job" as const },
  ];

  it("prefers a live location over the derived one", () => {
    const live = [{ userId: "tech-1", lat: 1, lng: 2, updatedAt: iso(1000) }];

    const result = mergeLivePositions(derived, live, NOW);

    const t1 = result.find((p) => p.userId === "tech-1")!;
    expect(t1).toMatchObject({ lat: 1, lng: 2, source: "live", stale: false });
  });

  it("keeps the derived position for a technician with no live fix", () => {
    const result = mergeLivePositions(derived, [], NOW);

    expect(result.find((p) => p.userId === "tech-2")).toMatchObject({
      lat: 20,
      source: "last_job",
    });
  });

  it("shows a live technician who has no derived position at all", () => {
    const live = [{ userId: "tech-9", lat: 5, lng: 5, updatedAt: iso(0) }];

    const result = mergeLivePositions([], live, NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ userId: "tech-9", source: "live" });
  });

  // The fix is real but aging — flag it so the dispatcher knows it may be behind.
  it("marks an old live fix as stale", () => {
    const live = [{ userId: "tech-1", lat: 1, lng: 1, updatedAt: iso(120_000) }];

    const result = mergeLivePositions(derived, live, NOW);

    expect(result.find((p) => p.userId === "tech-1")).toMatchObject({
      source: "live",
      stale: true,
    });
  });

  it("carries the accuracy and timestamp through", () => {
    const live = [{ userId: "tech-1", lat: 1, lng: 1, accuracy: 7, updatedAt: iso(0) }];

    const result = mergeLivePositions(derived, live, NOW);

    expect(result.find((p) => p.userId === "tech-1")).toMatchObject({
      accuracy: 7,
      updatedAt: iso(0),
    });
  });
});

describe("technicianStatus", () => {
  const at = (source: "live" | "home" | "last_job", stale = false) => ({
    userId: "t", lat: 0, lng: 0, source, stale,
  });

  it("is offline with no position", () => {
    expect(technicianStatus(undefined)).toBe("offline");
  });

  it("is live for a fresh GPS fix", () => {
    expect(technicianStatus(at("live"))).toBe("live");
  });

  it("is stale for an aging GPS fix", () => {
    expect(technicianStatus(at("live", true))).toBe("stale");
  });

  it("is derived for a home or last-job position", () => {
    expect(technicianStatus(at("home"))).toBe("derived");
    expect(technicianStatus(at("last_job"))).toBe("derived");
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("is empty without a timestamp", () => {
    expect(formatAge(undefined, now)).toBe("");
  });

  it("reads 'just now' under a minute (no seconds counter)", () => {
    expect(formatAge(ago(5_000), now)).toBe("just now");
    expect(formatAge(ago(45_000), now)).toBe("just now");
  });

  it("reads minutes, then hours, then days", () => {
    expect(formatAge(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(formatAge(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(formatAge(ago(2 * 86_400_000), now)).toBe("2 d ago");
  });
});

describe("techJobsToday", () => {
  it("returns only this tech's today jobs, ordered by time slot", () => {
    const deals = [
      deal({ id: "b", assignedTechId: "t1", scheduledDate: TODAY, scheduledTimeSlot: "13:00-15:00" }),
      deal({ id: "a", assignedTechId: "t1", scheduledDate: TODAY, scheduledTimeSlot: "09:00-11:00" }),
      deal({ id: "other-tech", assignedTechId: "t2", scheduledDate: TODAY, scheduledTimeSlot: "10:00" }),
      deal({ id: "other-day", assignedTechId: "t1", scheduledDate: "2026-07-13" }),
    ];
    expect(techJobsToday(deals, "t1", TODAY).map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("technicianAvailability", () => {
  const pos: TechnicianPosition = { userId: "t1", lat: 1, lng: 2, source: "home" };
  it("is offline without a position", () => {
    expect(technicianAvailability([], undefined)).toBe("offline");
  });
  it("is on_job when an active-stage job exists", () => {
    expect(technicianAvailability([deal({ stage: DealStage.ON_SITE })], pos)).toBe("on_job");
  });
  it("is available when placeable but idle", () => {
    expect(technicianAvailability([deal({ stage: DealStage.ASSIGNED })], pos)).toBe("available");
    expect(technicianAvailability([], pos)).toBe("available");
  });
});

describe("techJobProgress", () => {
  it("points at the active job's place in the day", () => {
    const jobs = [
      deal({ stage: DealStage.COMPLETED }),
      deal({ stage: DealStage.ON_SITE }),
      deal({ stage: DealStage.ASSIGNED }),
    ];
    expect(techJobProgress(jobs)).toEqual({ current: 2, total: 3 });
  });
  it("counts completed when nothing is active", () => {
    const jobs = [deal({ stage: DealStage.COMPLETED }), deal({ stage: DealStage.ASSIGNED })];
    expect(techJobProgress(jobs)).toEqual({ current: 1, total: 2 });
  });
});

describe("isInTimeOrder", () => {
  const j = (slot?: string) => deal({ scheduledTimeSlot: slot });
  it("accepts a chronological order", () => {
    expect(isInTimeOrder([j("09:00-11:00"), j("13:00-15:00"), j("15:00-18:00")])).toBe(true);
  });
  it("rejects an out-of-order sequence", () => {
    expect(isInTimeOrder([j("13:00-15:00"), j("09:00-11:00")])).toBe(false);
  });
  it("treats slotless jobs as last and stays satisfied", () => {
    expect(isInTimeOrder([j("09:00-11:00"), j(undefined)])).toBe(true);
  });
  it("is trivially true for zero or one job", () => {
    expect(isInTimeOrder([])).toBe(true);
    expect(isInTimeOrder([j("09:00")])).toBe(true);
  });
});
