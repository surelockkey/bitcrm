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

const permissionsMock = vi.fn();
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => permissionsMock(),
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
  it("keeps the New Job button in the header for users who can create jobs", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    renderHeader();

    const newJob = screen.getByRole("link", { name: /new job/i });
    expect(newJob).toHaveAttribute("href", "/deals/new");
    // Same right-side flex cluster as the user menu.
    expect(newJob.parentElement).toBe(
      screen.getByTestId("nav-user").parentElement,
    );
  });

  it("hides the New Job button without the create permission", () => {
    permissionsMock.mockReturnValue({
      can: (_r: string, action?: string) => action !== "create",
    });
    renderHeader();

    expect(
      screen.queryByRole("link", { name: /new job/i }),
    ).not.toBeInTheDocument();
  });

  it("puts the search trigger in the right-side cluster", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    renderHeader();

    const search = screen.getByRole("button", { name: /search deals/i });
    expect(search.parentElement).toBe(
      screen.getByTestId("nav-user").parentElement,
    );
  });
});
