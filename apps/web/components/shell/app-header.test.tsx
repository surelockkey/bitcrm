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
});
