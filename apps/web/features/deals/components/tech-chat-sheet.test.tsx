import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/telephony/softphone-manager", () => ({ startCall: vi.fn() }));
vi.mock("@/features/messaging/components/party-chat", () => ({
  PartyChat: () => <div data-testid="party-chat" />,
}));

import { TechChatSheet } from "./tech-chat-sheet";

/**
 * The panel has to be wide enough to hold a conversation. `SheetContent` caps a
 * right-hand sheet at `data-[side=right]:sm:max-w-sm` — an attribute selector,
 * so a plain `sm:max-w-[…]` from here loses to it on specificity and the panel
 * silently stays 384px no matter what number is written. The override must
 * carry the same `data-[side=right]` prefix to land.
 */
describe("TechChatSheet", () => {
  const open = () =>
    render(
      <TechChatSheet techId="u1" name="Reonquez Thompson" phone="+14692451831" open onOpenChange={() => {}} />
    );

  it("is wide enough to read a conversation in", () => {
    open();

    const panel = screen.getByRole("dialog");
    expect(panel.className).toMatch(/data-\[side=right\]:sm:max-w-\[640px\]/);
  });

  it("states its width at the specificity the sheet's own default is written at", () => {
    open();

    const classes = screen.getByRole("dialog").className.split(/\s+/);
    // A bare width or max-width utility here is dead code: the primitive's
    // `data-[side=right]:w-3/4` and `…:sm:max-w-sm` outrank it.
    expect(classes.filter((c) => /^(sm:)?(max-)?w-/.test(c))).toEqual([]);
  });

  it("fills the screen on a phone", () => {
    open();

    expect(screen.getByRole("dialog").className).toMatch(/data-\[side=right\]:w-full/);
  });
});
