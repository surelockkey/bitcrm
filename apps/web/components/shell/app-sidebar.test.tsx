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

// The Messages item carries an unread badge fed by the inbox counters query;
// the shell tests run without a QueryClient, so hand it a settable value.
const countersMock = vi.fn(() => ({ data: undefined as { unreadConversations: number } | undefined }));
vi.mock("@/features/messaging/hooks", () => ({
  useInboxCounters: () => countersMock(),
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
    // Expanded: the button spans the rail.
    expect(newJob.className).toContain("w-full");
    // Collapsed (icon) mode: shrinks to a square via animatable props.
    expect(newJob.className).toContain("group-data-[collapsible=icon]:w-8");
    expect(newJob.className).toContain("group-data-[collapsible=icon]:h-8");
    // border-radius rides along so the hover morph into an oval animates too.
    expect(newJob.className).toContain("transition-[width,height,border-radius]");
    // The plus icon never moves: same left padding in both states, so no
    // justify-center recentering and no p-0 swap.
    expect(newJob.className).toContain("justify-start");
    expect(newJob.className).not.toContain("group-data-[collapsible=icon]:p-0");
    // The label fades/clips instead of popping out of the layout.
    expect(newJob.className).toContain("overflow-hidden");
    expect(screen.getByText("Create New Job").className).toContain(
      "group-data-[collapsible=icon]:opacity-0",
    );
  });

  it("shapes the New Job button the way Workiz shapes theirs", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    renderSidebar();

    const newJob = screen.getByRole("link", { name: /create new job/i });

    // At rest it is a plain white full-width row: no border, no fill.
    expect(newJob.className).toContain("border-transparent");
    expect(newJob.className).not.toContain("bg-primary");

    // The yellow lives in the round dot, not in the button.
    const dot = newJob.querySelector("[data-slot='new-job-dot']");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("rounded-full");
    expect(dot?.className).toContain("bg-primary");

    // Hover turns the row into a bordered oval.
    expect(newJob.className).toContain("hover:rounded-full");
    expect(newJob.className).toContain("hover:border-border");
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
    expect(screen.queryByText("Payments")).not.toBeInTheDocument();
    // Billing is live now.
    expect(screen.getByText("Invoices")).toBeInTheDocument();
    expect(screen.getByText("Estimates")).toBeInTheDocument();
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

    expect(screen.getByRole("link", { name: /^my jobs$/i })).toHaveAttribute("href", "/my-jobs");
    expect(screen.getByText("My Profile")).toBeInTheDocument();
    // The van is gated on containers.view, which this technician doesn't hold.
    expect(screen.queryByText("My Stock")).not.toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Contacts")).not.toBeInTheDocument();
  });

  it("offers the technician their own stock once they may view containers", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "containers", isTechnician: true });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^my stock$/i })).toHaveAttribute("href", "/my-stock");
  });

  it("gives technicians a Messages item once they may view messages", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "messages", isTechnician: true });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^messages$/i })).toHaveAttribute("href", "/messages");
  });

  it("shows Messages under Communications with the unread count as a badge", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    countersMock.mockReturnValue({ data: { unreadConversations: 7 } });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^messages$/i })).toHaveAttribute("href", "/messages");
    expect(screen.getByLabelText("7 unread conversations")).toHaveTextContent("7");
  });

  it("shows Automations under Communications", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^automations$/i })).toHaveAttribute(
      "href",
      "/automations",
    );
  });

  it("keeps the Messages item plain when nothing is unread", () => {
    permissionsMock.mockReturnValue({ can: () => true, isTechnician: false });
    countersMock.mockReturnValue({ data: { unreadConversations: 0 } });
    renderSidebar();

    expect(screen.queryByLabelText(/unread conversation/)).not.toBeInTheDocument();
  });

  /**
   * Workiz draws a rule under its logo, so the brand reads as a header rather
   * than as the first row of the menu.
   */
  it("separates the logo from the menu with a rule", () => {
    renderSidebar();

    const rule = document.querySelector('[data-slot="brand-rule"]');
    expect(rule).not.toBeNull();
  });

  it("keeps the rule full width so nothing shifts as the sidebar collapses", () => {
    renderSidebar();

    const rule = document.querySelector('[data-slot="brand-rule"]');
    // A margin that changes with the state would make the line jump while the
    // width animates — the same trap the logo padding avoids.
    expect(rule?.className).not.toMatch(/group-data-\[collapsible=icon\]:(mx|px|ml|mr)-/);
  });
});
