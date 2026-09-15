import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHeader } from "./app-header";

vi.mock("@/features/telephony/components/softphone-controls", () => ({
  SoftphoneControls: () => <div data-testid="softphone" />,
}));

vi.mock("./nav-user", () => ({
  NavUser: () => <div data-testid="nav-user" />,
}));

vi.mock("@/stores/ui-store", () => ({
  useUiStore: (
    selector: (s: { setCommandOpen: (open: boolean) => void }) => unknown,
  ) => selector({ setCommandOpen: vi.fn() }),
}));

// The inbox button reads permissions and the unread counters; neither has a
// provider here, so both are handed in.
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isTechnician: false, isLoading: false }),
}));
const countersMock = vi.fn(() => ({ data: undefined as { unreadConversations: number } | undefined }));
vi.mock("@/features/messaging/hooks", () => ({
  useInboxCounters: () => countersMock(),
}));

function renderHeader() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppHeader />
      </SidebarProvider>
    </TooltipProvider>,
  );
}

describe("AppHeader", () => {
  // New Job lives in the sidebar header now — see app-sidebar.test.tsx.
  it("does not render a New Job button", () => {
    renderHeader();

    expect(
      screen.queryByRole("link", { name: /new job/i }),
    ).not.toBeInTheDocument();
  });

  it("puts the search trigger in the right-side cluster", () => {
    renderHeader();

    const search = screen.getByRole("button", { name: /search deals/i });
    expect(search.parentElement).toBe(
      screen.getByTestId("nav-user").parentElement,
    );
  });

  it("links to the inbox with the unread count as a badge", () => {
    countersMock.mockReturnValue({ data: { unreadConversations: 12 } });
    renderHeader();

    const link = screen.getByRole("link", { name: "Messages, 12 unread" });
    expect(link).toHaveAttribute("href", "/messages");
    expect(screen.getByTestId("inbox-header-badge")).toHaveTextContent("12");
  });

  it("keeps the inbox button plain when nothing is unread", () => {
    countersMock.mockReturnValue({ data: { unreadConversations: 0 } });
    renderHeader();

    expect(screen.getByRole("link", { name: "Messages" })).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-header-badge")).toBeNull();
  });
});
