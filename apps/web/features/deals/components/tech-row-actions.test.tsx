import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { push, startCall, conversation } = vi.hoisted(() => ({
  push: vi.fn(),
  startCall: vi.fn(),
  conversation: { value: null as { id: string } | null },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/telephony/softphone-manager", () => ({ startCall }));
vi.mock("@/features/messaging/api", () => ({
  getConversationByParty: () => Promise.resolve(conversation.value),
}));

import { TechRowActions } from "./tech-row-actions";

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
    push.mockClear();
    startCall.mockClear();
    conversation.value = null;
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

  it("opens the conversation the technician already has", async () => {
    conversation.value = { id: "conv-7" };
    render(<TechRowActions techId="u1" user={tech} />);

    await userEvent.click(screen.getByRole("button", { name: "Message technician" }));

    expect(push).toHaveBeenCalledWith("/messages?c=conv-7");
  });

  it("opens the team inbox when there is no conversation yet", async () => {
    conversation.value = null;
    render(<TechRowActions techId="u1" user={tech} />);

    await userEvent.click(screen.getByRole("button", { name: "Message technician" }));

    expect(push).toHaveBeenCalledWith("/messages?view=team");
  });

  it("shows what is known about the technician", async () => {
    render(<TechRowActions techId="u1" user={tech} />);

    await userEvent.click(screen.getByRole("button", { name: "Technician details" }));

    // A US number reads the way a dispatcher dials it, without the +1.
    expect(await screen.findByText("(469) 245-1831")).toBeInTheDocument();
    expect(screen.getByText("r@example.com")).toBeInTheDocument();
  });

  it("leaves out what it does not know, rather than saying null", () => {
    // Workiz prints "Notes: null" here; an empty line is not worth a word.
    render(<TechRowActions techId="u1" user={{ firstName: "Reonquez", lastName: "Thompson" }} />);
    expect(screen.queryByText(/null/i)).toBeNull();
  });
});
