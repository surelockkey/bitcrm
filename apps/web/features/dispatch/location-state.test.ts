import { describe, expect, it } from "vitest";
import { locationIssue, statesById, withoutLocation, type TechnicianLocationState } from "./location-state";

/**
 * Whose phone is not sharing its location (owner, 2026-10-15): the phone says
 * what the OS lets the app do, and the map names it instead of leaving a pin
 * that simply stopped moving.
 */
const state = (over: Partial<TechnicianLocationState> = {}): TechnicianLocationState => ({
  userId: "t1",
  permission: "granted",
  updatedAt: "2026-10-15T14:00:00.000Z",
  ...over,
});

describe("locationIssue", () => {
  it("a phone that refused location: off", () => {
    expect(locationIssue(state({ permission: "denied" }))).toEqual({
      kind: "off",
      label: "Location off",
      detail: "Location off on the phone",
      tone: "danger",
    });
  });

  // Never asked or never answered: the app reads no location either.
  it("a phone that has not allowed it yet: off as well", () => {
    expect(locationIssue(state({ permission: "undetermined" }))?.kind).toBe("off");
  });

  it("allowed, but only roughly (iOS Precise Location off): approximate", () => {
    expect(locationIssue(state({ precise: false }))).toEqual({
      kind: "approximate",
      label: "Approximate location only",
      detail: "Approximate location only",
      tone: "warning",
    });
  });

  it("off wins over approximate — there is no position at all", () => {
    expect(locationIssue(state({ permission: "denied", precise: false }))?.kind).toBe("off");
  });

  it("allowed and precise, or precision unknown: nothing to say", () => {
    expect(locationIssue(state({ precise: true }))).toBeNull();
    expect(locationIssue(state())).toBeNull();
  });

  // A phone on an older build says nothing: no claim either way.
  it("no state from the phone: nothing to say", () => {
    expect(locationIssue(undefined)).toBeNull();
  });
});

describe("withoutLocation", () => {
  const states = statesById([
    state({ userId: "t1", permission: "denied" }),
    state({ userId: "t2", permission: "granted", precise: false }),
    state({ userId: "t3", permission: "undetermined" }),
    state({ userId: "office-1", permission: "denied" }),
  ]);

  it("the team's people whose phone shares no location — approximate still shares one", () => {
    expect([...withoutLocation(["t1", "t2", "t3", "t4"], states)]).toEqual(["t1", "t3"]);
  });

  it("counts only people on the team, whatever else the phones said", () => {
    expect(withoutLocation(["t2", "t4"], states).size).toBe(0);
  });
});
