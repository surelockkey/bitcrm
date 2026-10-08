import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ startCall: vi.fn(), chat: vi.fn() }));
vi.mock("@/features/telephony/softphone-manager", () => ({ startCall: mocks.startCall }));
vi.mock("@/features/messaging/components/party-chat", () => ({
  PartyChat: (props: Record<string, unknown>) => {
    mocks.chat(props);
    return <div data-testid="party-chat" />;
  },
}));

import { ClientChatSheet } from "./client-chat-sheet";

/** The client's thread beside the card, as the technician's sits beside the job. */
describe("ClientChatSheet", () => {
  it("opens the client's own thread, as wide as the job's chat, with a Call button in the header", async () => {
    render(<ClientChatSheet contactId="c1" name="CBRE Facilities Management" phone="+18557836342" open onOpenChange={() => {}} />);

    const panel = screen.getByRole("dialog");
    expect(panel.className).toMatch(/data-\[side=right\]:sm:max-w-\[640px\]/);
    expect(screen.getByTestId("party-chat")).toBeInTheDocument();
    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({ partyKind: "contact", partyId: "c1" }));

    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(mocks.startCall).toHaveBeenCalledWith("+18557836342");
  });

  // The job page texts the job's number (Workiz's Message Client) — and says
  // whether the client record carries it.
  it("hands the number and the job to the thread", () => {
    render(
      <ClientChatSheet contactId="c1" name="CDB" phone="+15715310137" phoneOnContact={false} dealId="d1" open onOpenChange={() => {}} />,
    );
    expect(mocks.chat).toHaveBeenLastCalledWith(
      expect.objectContaining({ partyId: "c1", address: "+15715310137", addressOnParty: false, dealId: "d1" }),
    );
  });

  it("mounts the thread only while open", () => {
    render(<ClientChatSheet contactId="c1" name="CBRE" open={false} onOpenChange={() => {}} />);
    expect(screen.queryByTestId("party-chat")).toBeNull();
  });
});
