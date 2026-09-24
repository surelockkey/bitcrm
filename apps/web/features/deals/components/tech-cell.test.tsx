import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TechCell } from "./tech-cell";
import { techColor } from "../tech-color";
import type { DirectoryUser } from "@/features/deals/hooks";

/** The app provides this once at the root; a test renders its own. */
const render = (ui: React.ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

/**
 * Workiz's Tech column, which dispatchers read at a glance: a chip in the
 * technician's own colour, and under it three marks — the job was sent, the
 * technician confirmed it, and the job has a call. In Workiz a job with no
 * technician can still show the call mark, so the marks stand on their own.
 */
const user = (id: string, first: string, last: string): [string, DirectoryUser] => [
  id,
  { id, firstName: first, lastName: last } as DirectoryUser,
];

const map = new Map<string, DirectoryUser>([
  user("u1", "Yeter", "Mizrahi"),
  user("u2", "David", "Szender"),
]);

const deal = (over: Record<string, unknown> = {}) =>
  ({ id: "d1", assignedTechIds: ["u1"], ...over }) as never;

describe("TechCell", () => {
  it("names the technician on the job", () => {
    render(<TechCell deal={deal()} userMap={map} />);
    expect(screen.getByText("Yeter Mizrahi")).toBeInTheDocument();
  });

  it("marks a job that was sent to the technician", () => {
    render(<TechCell deal={deal({ sentToTechAt: "2026-09-24T10:00:00.000Z" })} userMap={map} />);
    expect(screen.getByLabelText("Sent to tech")).toBeInTheDocument();
  });

  it("marks a job the technician opened, which is the green tick in Workiz", () => {
    // Workiz has no separate "confirmed": its tick means the technician saw
    // the job, and that is what the import brings over.
    render(<TechCell deal={deal({ seenByTechAt: "2026-09-24T10:05:00.000Z" })} userMap={map} />);
    expect(screen.getByLabelText("Tech confirmed")).toBeInTheDocument();
  });

  it("marks a job the technician confirmed", () => {
    render(<TechCell deal={deal({ techConfirmedAt: "2026-09-24T10:05:00.000Z" })} userMap={map} />);
    expect(screen.getByLabelText("Tech confirmed")).toBeInTheDocument();
  });

  it("marks a job that has a call", () => {
    render(<TechCell deal={deal({ hasCalls: true })} userMap={map} />);
    expect(screen.getByLabelText("Has a call")).toBeInTheDocument();
  });

  it("shows nothing that did not happen", () => {
    render(<TechCell deal={deal()} userMap={map} />);
    expect(screen.queryByLabelText("Sent to tech")).toBeNull();
    expect(screen.queryByLabelText("Tech confirmed")).toBeNull();
    expect(screen.queryByLabelText("Has a call")).toBeNull();
  });

  it("explains each mark in words, for anyone who has not learnt the icons", () => {
    render(
      <TechCell
        deal={deal({ sentToTechAt: "2026-09-24T10:00:00.000Z", techConfirmedAt: "2026-09-24T10:05:00.000Z", hasCalls: true })}
        userMap={map}
      />,
    );
    expect(screen.getByLabelText("Sent to tech")).toHaveAccessibleDescription(/sent/i);
    expect(screen.getByLabelText("Tech confirmed")).toHaveAccessibleDescription(/confirmed/i);
    expect(screen.getByLabelText("Has a call")).toHaveAccessibleDescription(/call/i);
  });

  it("shows the call mark on a job nobody is assigned to", () => {
    // Workiz does: the marks are about the job, not about the chip above them.
    render(<TechCell deal={deal({ assignedTechIds: [], hasCalls: true })} userMap={map} />);
    expect(screen.getByLabelText("Has a call")).toBeInTheDocument();
  });
});

describe("techColor", () => {
  it("gives the same technician the same colour every time", () => {
    expect(techColor("u1")).toBe(techColor("u1"));
  });

  it("tells two technicians apart", () => {
    const colours = new Set(["u1", "u2", "u3", "u4", "u5"].map(techColor));
    expect(colours.size).toBeGreaterThan(1);
  });

  it("is a colour even for an id it has never seen", () => {
    expect(techColor("")).toBeTruthy();
  });
});
