import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TechList, techRows } from "./tech-list";
import { statesById, type TechnicianLocationState } from "../location-state";
import type { TechnicianPosition } from "../lib";

/**
 * The Techs tab names a phone that shares no location (owner, 2026-10-15):
 * "Location off" in red, "Approximate location only" in amber — beside the
 * status the row already gives, which stays as it was.
 */
const NOW = Date.parse("2026-10-15T14:30:00.000Z");
const users = new Map([
  ["t-off", { id: "t-off", firstName: "Ola", lastName: "Off" }],
  ["t-ask", { id: "t-ask", firstName: "Ash", lastName: "Ask" }],
  ["t-rough", { id: "t-rough", firstName: "Rae", lastName: "Rough" }],
  ["t-ok", { id: "t-ok", firstName: "Oki", lastName: "Fine" }],
]);
const positions: TechnicianPosition[] = [
  { userId: "t-rough", lat: 1, lng: 1, source: "live", updatedAt: "2026-10-15T14:30:00.000Z", stale: false },
  { userId: "t-ok", lat: 2, lng: 2, source: "live", updatedAt: "2026-10-15T14:30:00.000Z", stale: false },
  { userId: "t-off", lat: 3, lng: 3, source: "home" },
];
const at = "2026-10-15T14:05:00.000Z";
const states = statesById([
  { userId: "t-off", permission: "denied", updatedAt: at },
  { userId: "t-ask", permission: "undetermined", updatedAt: at },
  { userId: "t-rough", permission: "granted", precise: false, updatedAt: at },
  { userId: "t-ok", permission: "granted", precise: true, updatedAt: at },
] satisfies TechnicianLocationState[]);

const rows = () => techRows({ userIds: [...users.keys()], positions, userMap: users, now: NOW, states });
const row = (id: string) => rows().find((r) => r.userId === id)!;

describe("techRows — the phone's location", () => {
  it("a phone that refused location, or never allowed it: Location off, in red", () => {
    expect(row("t-off").notice).toEqual({ text: "Location off", tone: "danger" });
    expect(row("t-ask").notice).toEqual({ text: "Location off", tone: "danger" });
  });

  it("a rough position only: Approximate location only, in amber", () => {
    expect(row("t-rough").notice).toEqual({ text: "Approximate location only", tone: "warning" });
  });

  it("a phone that shares a precise location, or has said nothing: no notice", () => {
    expect(row("t-ok").notice).toBeUndefined();
    expect(techRows({ userIds: ["t-ok"], positions, userMap: users, now: NOW }).at(0)?.notice).toBeUndefined();
  });

  it("keeps the status the row gave, and the order", () => {
    expect(row("t-off").label).toBe("No live GPS");
    expect(row("t-rough").label).toBe("Online · just now");
    expect(rows().map((r) => r.userId)).toEqual(["t-ok", "t-rough", "t-off", "t-ask"]);
  });

  it("draws the notice under the name in its colour", () => {
    render(<TechList rows={rows()} addresses={new Map()} hoveredId={null} onHover={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getByTestId("tech-row-t-off")).toHaveTextContent(/Ola Off\s*Location off\s*No live GPS/);
    const off = screen.getAllByText("Location off")[0];
    expect(off.className).toContain("text-wz-danger");
    expect(screen.getByText("Approximate location only").className).toContain("text-warning-text");
    expect(screen.getByTestId("tech-row-t-ok")).not.toHaveTextContent(/Location off|Approximate/);
  });
});
