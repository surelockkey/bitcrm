import { describe, expect, it } from "vitest";
import {
  ClientType,
  DealPriority,
  DealStage,
  DealStatus,
  type Deal,
  type TechnicianProfile,
} from "@bitcrm/types";
import { splitByLocation, technicianPositions } from "./lib";

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
    jobType: "lockout",
    stage: DealStage.NEW_LEAD,
    assignedDispatcherId: "dispatcher-1",
    priority: DealPriority.NORMAL,
    tags: [],
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
