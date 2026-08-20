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

  it("shows a New Job action under the logo for users who can create jobs", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    renderSidebar();

    const newJob = screen.getByRole("link", { name: /new job/i });
    expect(newJob).toHaveAttribute("href", "/deals/new");
    // It lives in the sidebar header block, right under the logo link.
    const header = screen
      .getByRole("link", { name: "BitCRM home" })
      .closest('[data-sidebar="header"]');
    expect(header).toContainElement(newJob);
  });

  it("hides the New Job action when the user cannot create jobs", () => {
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
    expect(screen.queryByText("Products")).not.toBeInTheDocument();
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
