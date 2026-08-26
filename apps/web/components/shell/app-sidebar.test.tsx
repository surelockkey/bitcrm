import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./app-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/deals",
}));

const permissionsMock = vi.fn();
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => permissionsMock(),
}));

function renderSidebar() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>,
  );
}

describe("AppSidebar", () => {
  it("renders the brand logo image in the header home link", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    renderSidebar();

    const homeLink = screen.getByRole("link", { name: "BitCRM home" });
    expect(homeLink.querySelector("img")).not.toBeNull();
  });

  it("keeps the logo pinned during collapse instead of re-centering it", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    renderSidebar();

    const homeLink = screen.getByRole("link", { name: "BitCRM home" });
    // No per-state alignment switch — a justify/padding swap is what made the
    // icon jump while the sidebar width animated.
    expect(homeLink.className).not.toContain("justify-center");
    expect(homeLink.className).toContain("overflow-hidden");
    // The wordmark clips/fades out instead of popping from the layout.
    expect(screen.getByText("BitCRM").className).toContain(
      "group-data-[collapsible=icon]:opacity-0",
    );
  });

  it("renders a compact New Job button that collapses smoothly with the sidebar", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    renderSidebar();

    const newJob = screen.getByRole("link", { name: /new job/i });
    expect(newJob).toHaveAttribute("href", "/deals/new");
    // Expanded: fixed width (explicit, so the collapse can animate it).
    expect(newJob.className).toContain("w-30");
    // Collapsed (icon) mode: shrinks to a square via animatable props.
    expect(newJob.className).toContain("group-data-[collapsible=icon]:w-8");
    expect(newJob.className).toContain("group-data-[collapsible=icon]:h-8");
    expect(newJob.className).toContain("transition-[width,height]");
    // The plus icon never moves: same left padding in both states, so no
    // justify-center recentering and no p-0 swap.
    expect(newJob.className).toContain("justify-start");
    expect(newJob.className).not.toContain("group-data-[collapsible=icon]:p-0");
    // The label fades/clips instead of popping out of the layout.
    expect(newJob.className).toContain("overflow-hidden");
    expect(screen.getByText("New Job").className).toContain(
      "group-data-[collapsible=icon]:opacity-0",
    );
  });

  it("hides the New Job button without the create permission", () => {
    permissionsMock.mockReturnValue({
      can: (_r: string, action?: string) => action !== "create",
      isTechnician: false,
    });
    renderSidebar();

    expect(
      screen.queryByRole("link", { name: /new job/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the permitted full nav and hides coming-soon items", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    renderSidebar();

    expect(screen.getByText("Jobs")).toBeInTheDocument();
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Dispatch Map")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    // Inventory is a single entry now — the old per-section items are gone.
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    expect(screen.queryByText("Products")).not.toBeInTheDocument();
    expect(screen.queryByText("Items")).not.toBeInTheDocument();
    expect(screen.queryByText("Warehouses")).not.toBeInTheDocument();
    // The reports hub is a real page now, not a roadmap stub.
    expect(screen.getByText("Reports")).toBeInTheDocument();
    // coming-soon, hidden by default:
    expect(screen.queryByText("Invoices")).not.toBeInTheDocument();
  });

  it("hides groups a user cannot view", () => {
    // Can view deals/contacts only.
    permissionsMock.mockReturnValue({
      can: (r: string) => r === "deals" || r === "contacts",
      isTechnician: false,
    });
    renderSidebar();

    expect(screen.getByText("Jobs")).toBeInTheDocument();
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Inventory")).not.toBeInTheDocument();
  });

  it("shows Inventory when the user can view any inventory resource", () => {
    permissionsMock.mockReturnValue({
      can: (r: string) => r === "warehouses",
      isTechnician: false,
    });
    renderSidebar();

    expect(screen.getByText("Inventory")).toBeInTheDocument();
  });

  it("renders the minimal technician shell", () => {
    permissionsMock.mockReturnValue({ can: () => false, isTechnician: true });
    renderSidebar();

    expect(screen.getByText("My Jobs")).toBeInTheDocument();
    expect(screen.getByText("My Container")).toBeInTheDocument();
    expect(screen.getByText("My Profile")).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Contacts")).not.toBeInTheDocument();
  });
});
