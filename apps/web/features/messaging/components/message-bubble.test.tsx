import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageBubble } from "./message-bubble";

/**
 * Workiz paints an outbound bubble in their ink (#3b4b52, sampled from
 * workiz_chat/01_thread.png), not in the action yellow. These assert the
 * bubble never picks up `primary`, which is the yellow.
 */

const base = {
  id: "m1",
  body: "Hi! This is Jade from Sure Lock & Key.",
  createdAt: "2026-09-17T08:11:00.000Z",
  authorName: "Jade",
} as const;

function renderBubble(direction: "inbound" | "outbound") {
  render(
    <TooltipProvider>
      <MessageBubble message={{ ...base, direction } as never} canManage={false} />
    </TooltipProvider>,
  );
}

function bubbleOf(text: string): HTMLElement {
  const node = screen.getByText(text).closest("[class*='rounded-[25px]']");
  if (!node) throw new Error("bubble wrapper not found");
  return node as HTMLElement;
}

describe("the outbound bubble", () => {
  it("is painted in the ink, not the action yellow", () => {
    renderBubble("outbound");
    const bubble = bubbleOf(base.body);
    expect(bubble.className).toContain("bg-foreground");
    expect(bubble.className).toContain("text-white");
    expect(bubble.className).not.toContain("bg-primary");
    // Workiz squares the speaker's corner: bottom-right on ours.
    expect(bubble.className).toContain("rounded-br-none");
  });

  it("leaves an inbound bubble white, its bottom-left corner square", () => {
    renderBubble("inbound");
    const bubble = bubbleOf(base.body);
    expect(bubble.className).toContain("bg-background");
    expect(bubble.className).toContain("rounded-bl-none");
    expect(bubble.className).not.toContain("bg-primary");
  });
});

describe("a portal line — what the client did, written by the system (Workiz)", () => {
  const portal = (over: Record<string, unknown>) =>
    render(
      <TooltipProvider>
        <MessageBubble
          message={{
            id: "p1",
            conversationId: "c1",
            channel: "note",
            direction: "inbound",
            origin: "system",
            status: "received",
            createdAt: "2026-10-02T14:05:00.000Z",
            updatedAt: "2026-10-02T14:05:00.000Z",
            ...over,
          } as never}
          canManage={false}
        />
      </TooltipProvider>,
    );

  it("reads as one centred line with the document a click away — no bubble, no Edit Job", () => {
    const { container } = portal({
      subject: "Josh Wilenski signed Invoice #O8E9NQ",
      portalEvent: "signed",
      entityType: "invoice",
      entityId: "d1",
      dealId: "d1",
    });
    expect(screen.getByText("Josh Wilenski signed Invoice #O8E9NQ")).toBeInTheDocument();
    expect(container.querySelector("[data-portal-event='signed']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open invoice" })).toHaveAttribute("href", "/deals/d1?tab=invoice");
    expect(screen.queryByText("System message")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit job/i })).not.toBeInTheDocument();
  });

  it("opens an estimate on its own page, and a client's invoice (no job) on its page", () => {
    portal({ subject: "Viewed estimate #K4T9ZW-1", portalEvent: "viewed", entityType: "estimate", entityId: "e1", dealId: "d1" });
    expect(screen.getByRole("link", { name: "Open estimate" })).toHaveAttribute("href", "/estimates/e1");
  });

  it("a client invoice with no job opens on /invoices", () => {
    portal({ subject: "Jane Client submitted payment for invoice #1001 ($50.00)", portalEvent: "payment", entityType: "invoice", entityId: "i9" });
    expect(screen.getByRole("link", { name: "Open invoice" })).toHaveAttribute("href", "/invoices/i9");
  });
});
