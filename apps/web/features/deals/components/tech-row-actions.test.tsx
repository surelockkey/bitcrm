import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { startCall, chatProps } = vi.hoisted(() => ({
  startCall: vi.fn(),
  chatProps: { last: null as Record<string, unknown> | null },
}));

vi.mock("@/features/telephony/softphone-manager", () => ({ startCall }));
vi.mock("./tech-chat-sheet", () => ({
  TechChatSheet: (props: Record<string, unknown>) => {
    chatProps.last = props;
    return props.open ? <div data-testid="tech-chat" /> : null;
  },
}));

import { TechRowActions, TechDetailsCard } from "./tech-row-actions";

/**
 * What a dispatcher does with the technician on a job, from the job: look them
 * up, call them, message them. Workiz reveals these on hover over the row, so
 * the list stays quiet until you reach for one.
 */
const tech = {
  id: "u1",
  firstName: "Reonquez",
  lastName: "Thompson",
  phone: "+14692451831",
  email: "r@example.com",
};

describe("TechRowActions", () => {
  beforeEach(() => {
    startCall.mockClear();
    chatProps.last = null;
  });

  it("offers looking up, calling and messaging", () => {
    render(<TechRowActions techId="u1" user={tech} />);

    expect(screen.getByRole("button", { name: "Technician details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call technician" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Message technician" })).toBeInTheDocument();
  });

  it("stays out of the way until the row is reached for", () => {
    const { container } = render(<TechRowActions techId="u1" user={tech} />);
    // Hidden by opacity rather than unmounted, so hovering does not reflow the row.
    expect(container.firstElementChild?.className).toMatch(/opacity-0/);
    expect(container.firstElementChild?.className).toMatch(/group-hover:opacity-100/);
  });

  it("dials the technician's own number", async () => {
    render(<TechRowActions techId="u1" user={tech} />);

    await userEvent.click(screen.getByRole("button", { name: "Call technician" }));

    expect(startCall).toHaveBeenCalledWith("+14692451831");
  });

  it("cannot dial someone with no number on file", () => {
    render(<TechRowActions techId="u1" user={{ ...tech, phone: undefined }} />);
    expect(screen.getByRole("button", { name: "Call technician" })).toBeDisabled();
  });

  it("opens the chat beside the job, without leaving it", async () => {
    render(<TechRowActions techId="u1" user={tech} dealId="d1" />);

    await userEvent.click(screen.getByRole("button", { name: "Message technician" }));

    expect(screen.getByTestId("tech-chat")).toBeInTheDocument();
    expect(chatProps.last).toMatchObject({ techId: "u1", name: "Reonquez Thompson", open: true });
  });

  it("sends the job along, so the message lands on the job's feed too", async () => {
    render(<TechRowActions techId="u1" user={tech} dealId="d1" />);

    await userEvent.click(screen.getByRole("button", { name: "Message technician" }));

    expect(chatProps.last).toMatchObject({ dealId: "d1" });
  });

  it("keeps the chat shut until it is asked for", () => {
    render(<TechRowActions techId="u1" user={tech} />);

    expect(screen.queryByTestId("tech-chat")).toBeNull();
    expect(chatProps.last).toMatchObject({ open: false });
  });

  it("opens its card on hover, not on a click", () => {
    render(<TechRowActions techId="u1" user={tech} />);
    // Radix mounts the card only once a real pointer arrives, which jsdom has
    // none of; the card's own words are tested below, on the card itself.
    expect(screen.getByRole("button", { name: "Technician details" })).toHaveAttribute("data-state", "closed");
  });

});

describe("TechDetailsCard", () => {
  it("says what is known about the technician", () => {
    render(
      <TechDetailsCard name="Reonquez Thompson" phone="+14692451831" email="r@example.com" address="18600 Dallas Pkwy, Dallas, TX" />,
    );

    // A US number reads the way a dispatcher dials it, without the +1.
    expect(screen.getByText("(469) 245-1831")).toBeInTheDocument();
    expect(screen.getByText("r@example.com")).toBeInTheDocument();
    expect(screen.getByText("18600 Dallas Pkwy, Dallas, TX")).toBeInTheDocument();
  });

  it("leaves out what it does not know, rather than saying null", () => {
    // Workiz prints "Notes: null" in this very card.
    const { container } = render(<TechDetailsCard name="Reonquez Thompson" />);

    expect(container.textContent).toBe("Reonquez Thompson");
  });
});
