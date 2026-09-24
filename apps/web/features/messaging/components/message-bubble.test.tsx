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
  const node = screen.getByText(text).closest("[class*='rounded-2xl']");
  if (!node) throw new Error("bubble wrapper not found");
  return node as HTMLElement;
}

describe("the outbound bubble", () => {
  it("is painted in the ink, not the action yellow", () => {
    renderBubble("outbound");
    const bubble = bubbleOf(base.body);
    expect(bubble.className).toContain("bg-foreground");
    expect(bubble.className).toContain("text-background");
    expect(bubble.className).not.toContain("bg-primary");
  });

  it("leaves an inbound bubble on the card surface", () => {
    renderBubble("inbound");
    const bubble = bubbleOf(base.body);
    expect(bubble.className).toContain("bg-card");
    expect(bubble.className).not.toContain("bg-primary");
  });
});
