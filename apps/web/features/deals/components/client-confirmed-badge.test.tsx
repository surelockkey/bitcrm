import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Deal } from "@bitcrm/types";
import { ClientConfirmedBadge } from "./client-confirmed-badge";

const NOW = new Date("2026-10-13T16:00:00.000Z");
const job = (over: Partial<Deal> = {}) =>
  ({
    scheduledDate: "2026-10-14",
    scheduledTimeSlot: "09:00-11:00",
    // 3:05 PM in Connecticut (EDT).
    clientConfirmedAt: "2026-10-12T19:05:00.000Z",
    clientConfirmedFor: "2026-10-14 09:00-11:00",
    ...over,
  }) as Deal;

/** B12: the job header says the client confirmed the visit through {{confirm_link}}. */
describe("ClientConfirmedBadge", () => {
  it("says the client confirmed, and when — on Connecticut's clock, labelled", () => {
    render(<ClientConfirmedBadge deal={job()} now={NOW} />);
    const badge = screen.getByText(/Confirmed by client/);
    expect(badge).toHaveTextContent("Confirmed by client · Oct 12, 3:05 PM EDT");
    expect(badge.closest("[title]")).toHaveAttribute("title", "The client confirmed this visit through the confirm link");
  });

  it("is absent until the client confirms, and once the job moved to another time", () => {
    const { container, rerender } = render(<ClientConfirmedBadge deal={job({ clientConfirmedAt: undefined })} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ClientConfirmedBadge deal={job({ scheduledTimeSlot: "13:00-15:00" })} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("wears the chip shape, not a padded pill", () => {
    render(<ClientConfirmedBadge deal={job()} now={NOW} />);
    const chip = screen.getByText(/Confirmed by client/).closest("span[title]")!;
    expect(chip.className).toContain("rounded-chip");
    expect(chip.className).not.toContain("rounded-full");
  });
});
