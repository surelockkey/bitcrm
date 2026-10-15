import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TechPinCard } from "./tech-pin-card";
import type { TechnicianPosition } from "../lib";

/**
 * The pin card says when and where a technician was last seen (owner,
 * 2026-10-15): the fix's time on Connecticut's clock, how long ago that was,
 * and the street it was on — a fix from yesterday included, dimmed on the map
 * but still the last real position, never swapped for the home address.
 */
const NOW = new Date("2026-10-15T18:36:00.000Z"); // 2:36 pm EDT
const noop = vi.fn();

function card(position: TechnicianPosition, address?: string) {
  return render(
    <TechPinCard
      position={position}
      name="Nazarii Tech"
      address={address}
      jobs={[]}
      title={() => ""}
      clientName={() => ""}
      canReorder={false}
      onReorder={noop}
      onSelectJob={noop}
      onClose={noop}
      now={NOW.getTime()}
    />,
  ).container;
}

describe("TechPinCard — Last seen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("gives the fix's time, how long ago, and the street it was on", () => {
    const view = card(
      { userId: "t1", lat: 41.76, lng: -72.67, source: "live", updatedAt: "2026-10-15T18:24:00.000Z", stale: true },
      "35 Killingworth Tpke, Clinton, CT",
    );
    expect(view).toHaveTextContent(/Last seen:\s*Thu Oct 15 2026 2:24 pm EDT · 12 min ago/);
    expect(view).toHaveTextContent("35 Killingworth Tpke, Clinton, CT");
    expect(view).not.toHaveTextContent(/no live GPS/i);
  });

  it("keeps yesterday's last position as Last seen, not the home address", () => {
    const view = card({ userId: "t1", lat: 49.84, lng: 24.0, source: "live", updatedAt: "2026-10-13T21:05:00.000Z", stale: true });
    expect(view).toHaveTextContent(/Last seen:\s*Tue Oct 13 2026 5:05 pm EDT · 1 d ago/);
  });

  it("says plainly when there is no fix at all", () => {
    const view = card({ userId: "t1", lat: 41.3, lng: -72.5, source: "home" });
    expect(view).toHaveTextContent(/Home address \(no live GPS\)/);
    expect(view).not.toHaveTextContent(/Last seen/);
  });
});
