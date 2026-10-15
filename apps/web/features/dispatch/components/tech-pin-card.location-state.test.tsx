import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TechPinCard } from "./tech-pin-card";
import type { TechnicianPosition } from "../lib";
import type { TechnicianLocationState } from "../location-state";

/**
 * A tech's pin card says when their phone shares no location (owner,
 * 2026-10-15) — in red, and since when, above "Last seen" — so the
 * dispatcher does not take a pin that stopped moving for a tech standing still.
 */
const NOW = new Date("2026-10-15T18:36:00.000Z"); // 2:36 pm EDT
const noop = vi.fn();
const fix: TechnicianPosition = {
  userId: "t1",
  lat: 41.76,
  lng: -72.67,
  source: "live",
  updatedAt: "2026-10-15T18:24:00.000Z",
  stale: true,
};

function card(locationState: TechnicianLocationState | undefined, position: TechnicianPosition = fix) {
  return render(
    <TechPinCard
      position={position}
      name="Nazarii Tech"
      jobs={[]}
      title={() => ""}
      clientName={() => ""}
      canReorder={false}
      onReorder={noop}
      onSelectJob={noop}
      onClose={noop}
      now={NOW.getTime()}
      locationState={locationState}
    />,
  ).container;
}

const since = "2026-10-15T18:11:00.000Z"; // 25 min before NOW

describe("TechPinCard — the phone's location", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("a phone that refused location: a red row, since when, above Last seen", () => {
    const view = card({ userId: "t1", permission: "denied", updatedAt: since });

    expect(view).toHaveTextContent(/Location off on the phone · 25 min ago\s*Last seen:/);
    expect(screen.getByText(/Location off on the phone/).className).toContain("text-wz-danger");
  });

  it("a phone that never allowed it says the same", () => {
    expect(card({ userId: "t1", permission: "undetermined", updatedAt: since })).toHaveTextContent(
      "Location off on the phone · 25 min ago",
    );
  });

  it("over the home address too, when no fix ever came", () => {
    const view = card({ userId: "t1", permission: "denied", updatedAt: since }, { userId: "t1", lat: 41.3, lng: -72.5, source: "home" });
    expect(view).toHaveTextContent(/Location off on the phone · 25 min ago\s*Location:\s*Home address/);
  });

  it("a rough position only: an amber row", () => {
    const view = card({ userId: "t1", permission: "granted", precise: false, updatedAt: since });

    expect(screen.getByText("Approximate location only").className).toContain("text-warning-text");
    expect(view).not.toHaveTextContent(/Location off/);
  });

  it("a phone sharing a precise location, or one that has said nothing: no row", () => {
    expect(card({ userId: "t1", permission: "granted", precise: true, updatedAt: since })).not.toHaveTextContent(
      /Location off|Approximate/,
    );
    expect(card(undefined)).not.toHaveTextContent(/Location off|Approximate/);
  });
});
