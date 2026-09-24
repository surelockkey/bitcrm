import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InboxNavBadge } from "./inbox-nav-badge";

const counters = vi.fn();
vi.mock("../hooks", () => ({
  useInboxCounters: () => counters(),
}));

function badge() {
  return screen.getByLabelText(/unread conversation/i);
}

describe("the unread badge on the Messages item", () => {
  it("stays hidden at zero", () => {
    counters.mockReturnValue({ data: { unreadConversations: 0 } });
    const { container } = render(<InboxNavBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("caps the count at 99+", () => {
    counters.mockReturnValue({ data: { unreadConversations: 412 } });
    render(<InboxNavBadge />);
    expect(badge()).toHaveTextContent("99+");
  });

  it("is a round red pill, the way Workiz badges an unread count", () => {
    counters.mockReturnValue({ data: { unreadConversations: 5 } });
    render(<InboxNavBadge />);
    expect(badge().className).toContain("rounded-full");
    expect(badge().className).toContain("bg-destructive");
  });

  it("keeps its white label when the nav item is hovered or active", () => {
    // SidebarMenuBadge repaints the label with the sidebar's accent ink on
    // peer-hover and when the item is active, which turned the red pill into
    // dark-on-red the moment the cursor touched Messages.
    counters.mockReturnValue({ data: { unreadConversations: 5 } });
    render(<InboxNavBadge />);
    const cls = badge().className;
    expect(cls).toContain(
      "peer-hover/menu-button:text-destructive-foreground",
    );
    expect(cls).toContain(
      "peer-data-active/menu-button:text-destructive-foreground",
    );
  });
});
