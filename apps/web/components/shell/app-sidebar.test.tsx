import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./app-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/deals",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const permissionsMock = vi.fn();
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => permissionsMock(),
}));

// The Messages item carries an unread badge fed by the inbox counters query;
// the shell tests run without a QueryClient, so hand it a settable value.
const countersMock = vi.fn(() => ({ data: undefined as { unreadConversations: number } | undefined }));
vi.mock("@/features/messaging/hooks", () => ({
  useInboxCounters: () => countersMock(),
}));

// The "Create new" menu hosts two creation dialogs; their bodies are not
// the sidebar's business (create-new-menu.test.tsx covers them).
vi.mock("@/features/clients/components/contact-form", () => ({
  ContactForm: () => <div data-testid="contact-form" />,
}));
vi.mock("@/features/estimates/components/new-client-estimate-dialog", () => ({
  NewClientEstimateDialog: () => null,
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

const allowAll = () => permissionsMock.mockReturnValue({ can: () => true, isTechnician: false, isLoading: false });

function navLinks() {
  return within(screen.getByTestId("app-nav")).getAllByRole("link").map((a) => a.textContent?.trim());
}

describe("AppSidebar", () => {
  it("renders the brand logo image in the header home link", () => {
    allowAll();
    renderSidebar();

    const homeLink = screen.getByRole("link", { name: "Shmorkiz home" });
    expect(homeLink.querySelector("img")).not.toBeNull();
  });

  /**
   * The logo is the SHMORKIZ pill, drawn the way Workiz draws its own: the
   * wordmark alone, 26px tall (Workiz's is 80×26), with no name typed beside
   * it — the pill already says it.
   */
  it("shows the Shmorkiz pill at Workiz's logo height and no typed name", () => {
    allowAll();
    renderSidebar();

    const homeLink = screen.getByRole("link", { name: "Shmorkiz home" });
    const wordmark = homeLink.querySelector('[data-slot="brand-wordmark"]');
    expect(wordmark?.tagName).toBe("IMG");
    expect(wordmark?.className).toContain("h-[26px]");
    expect(screen.queryByText("BitCRM")).toBeNull();
  });

  it("keeps the logo pinned during collapse instead of re-centering it", () => {
    allowAll();
    renderSidebar();

    const homeLink = screen.getByRole("link", { name: "Shmorkiz home" });
    // No per-state alignment switch — a justify/padding swap is what made the
    // icon jump while the sidebar width animated.
    expect(homeLink.className).not.toContain("justify-center");
    expect(homeLink.className).toContain("overflow-hidden");
    // The pill is too wide for the collapsed rail, so it clips/fades out
    // instead of popping from the layout…
    const wordmark = homeLink.querySelector('[data-slot="brand-wordmark"]');
    expect(wordmark?.className).toContain("group-data-[collapsible=icon]:opacity-0");
    // …while the round S mark fades in over the same left edge.
    const mark = homeLink.querySelector('[data-slot="brand-mark"]');
    expect(mark?.tagName).toBe("IMG");
    expect(mark?.className).toContain("opacity-0");
    expect(mark?.className).toContain("group-data-[collapsible=icon]:opacity-100");
    expect(mark?.className).toContain("absolute");
  });

  /**
   * Workiz's menu, word for word and in its order (app_audit_wz_home): Home |
   * Workiz Phone … | Schedule · Map · Jobs · Clients … | Estimates · Invoices
   * · Price book | Reports | Features ▸ Automations … Inventory. Our pages
   * Workiz lacks sit where Workiz would file them; its pages we lack are not
   * drawn, and Team / Settings are reached as in Workiz: from Settings and the
   * avatar menu, not from the sidebar.
   */
  it("lists the pages with Workiz's words, in Workiz's order", () => {
    allowAll();
    renderSidebar();

    expect(navLinks()).toEqual([
      "Home",
      "BitCRM Phone",
      "Messages",
      "Schedule",
      "Map",
      "Jobs",
      "Clients",
      "Companies",
      "Estimates",
      "Invoices",
      "Work Orders",
      "Price book",
      "Reports",
      "Automations",
      "Inventory",
    ]);
    for (const gone of ["Dashboard", "Dispatch Map", "Contacts", "Technicians", "Users", "Roles", "Settings"]) {
      expect(screen.queryByText(gone), gone).not.toBeInTheDocument();
    }
    // Nothing a Workiz user could click for nothing.
    for (const theirs of ["Answering", "Marketing", "Leads", "Recordings", "Workiz Pay", "Online booking"]) {
      expect(screen.queryByText(theirs), theirs).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/dispatch");
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute("href", "/contacts");
    expect(screen.getByRole("link", { name: "BitCRM Phone" })).toHaveAttribute("href", "/calls");
    expect(screen.getByRole("link", { name: "Price book" })).toHaveAttribute("href", "/price-book");
  });

  it("parts the blocks with thin rules and no captions, as Workiz does", () => {
    allowAll();
    renderSidebar();

    expect(document.querySelector('[data-sidebar="group-label"]')).toBeNull();
    for (const caption of ["Work", "Billing", "Team", "Communications", "Insights"]) {
      expect(screen.queryByText(caption), caption).not.toBeInTheDocument();
    }
    // Home | phone | work | documents | reports | features → five rules.
    expect(document.querySelectorAll('[data-slot="nav-rule"]')).toHaveLength(5);
  });

  it("draws no rule for a block the reader may not see", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "deals", isTechnician: false, isLoading: false });
    renderSidebar();

    expect(navLinks()).toEqual(["Home", "Schedule", "Map", "Jobs"]);
    expect(document.querySelectorAll('[data-slot="nav-rule"]')).toHaveLength(1);
    expect(screen.queryByText("Features")).not.toBeInTheDocument();
  });

  /**
   * Workiz's "Features" row heads an indented list under a "MY FEATURES"
   * caption that folds it. The row itself opens Workiz's marketplace, which
   * we have no counterpart for, so here it is a heading, not a link.
   */
  it("heads Automations and Inventory with Workiz's Features row and its folding caption", async () => {
    allowAll();
    renderSidebar();

    const heading = screen.getByText("Features");
    expect(heading.closest("a")).toBeNull();
    const toggle = screen.getByRole("button", { name: /my features/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const sub of ["Automations", "Inventory"]) {
      expect(screen.getByRole("link", { name: sub }).closest("li")).toHaveAttribute("data-nav-sub", "true");
    }

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Automations" })).not.toBeInTheDocument();
  });

  /**
   * At 1600×1000 the pinned Settings footer used to lie over the last row
   * (29px over "Reports") while the scrollbar was hidden, so the row could
   * not be clicked. Workiz pins nothing under its menu — Settings is in the
   * avatar menu — so nothing can cover a row here either, and a short window
   * scrolls the list with its scrollbar showing.
   */
  it("pins nothing under the menu: no footer, Settings lives in the avatar menu", () => {
    allowAll();
    renderSidebar();

    expect(document.querySelector('[data-sidebar="footer"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("lets a short window scroll the menu, scrollbar showing", () => {
    allowAll();
    renderSidebar();

    const content = document.querySelector('[data-sidebar="content"]')!;
    expect(content.className).toMatch(/\boverflow-y-auto\b/);
    expect(content.className).not.toMatch(/\bno-scrollbar\b/);
    // The last row is a plain row inside the scroller, nothing after it.
    const links = within(content as HTMLElement).getAllByRole("link");
    expect(links.at(-1)).toHaveTextContent("Inventory");
  });

  /**
   * Workiz's rows (app_audit_wz_home, nodeMenu): 184×35 at x=8, 8px in, r4,
   * a 16px glyph then 10px then 13px/19px words, rows 8px apart (43px pitch),
   * `#f3f6f7` under the cursor, `#e5f1ff` for the open page with the weight
   * unchanged. Our sidebar primitive draws 32px rows of 14px — overridden here.
   */
  it("draws Workiz's rows: 35px, 13px/19px, 4px corners, 8px apart", () => {
    allowAll();
    renderSidebar();

    const jobs = screen.getByRole("link", { name: "Jobs" });
    for (const cls of ["h-[35px]", "px-2", "gap-[10px]", "rounded-[4px]", "text-[13px]", "leading-[19px]"]) {
      expect(jobs.className, cls).toContain(cls);
    }
    expect(jobs.closest("li")?.className).toMatch(/\bpy-1\b/);
    // The open page: Workiz's light blue, the words no bolder.
    expect(jobs).toHaveAttribute("data-active", "true");
    expect(jobs.className).toContain("data-active:bg-accent");
    expect(jobs.className).toContain("data-active:font-normal");
    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute("data-active", "false");
  });

  it("offers Workiz's 'Create new' menu above the rows", () => {
    allowAll();
    renderSidebar();

    expect(screen.getByRole("button", { name: /create new/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create new job/i })).not.toBeInTheDocument();
  });

  /**
   * The permissions arrive a beat after the shell paints. The Create new row
   * used to appear then and push the whole menu down on every page load; now
   * its room is held while they load, and the menu — whose items depend on
   * them too — stays out of sight until it can be drawn where it will stay.
   */
  describe("while the permissions are on their way", () => {
    it("holds the Create new row's room, so the menu never moves when it arrives", () => {
      permissionsMock.mockReturnValue({ can: () => false, isTechnician: false, isLoading: true });
      const { container } = renderSidebar();

      const held = container.querySelector('[data-slot="create-new-held"]');
      expect(held).not.toBeNull();
      expect(held!.className).toMatch(/\bh-10\b/);
    });

    it("keeps the menu out of sight until it can be drawn in its place", () => {
      permissionsMock.mockReturnValue({ can: () => false, isTechnician: false, isLoading: true });
      const { container } = renderSidebar();

      expect(container.querySelector('[data-sidebar="content"]')!.className).toMatch(/\binvisible\b/);
    });

    it("shows the menu and the button once they are in", () => {
      allowAll();
      const { container } = renderSidebar();

      expect(container.querySelector('[data-slot="create-new-held"]')).toBeNull();
      expect(screen.getByRole("button", { name: /create new/i })).toBeInTheDocument();
      expect(container.querySelector('[data-sidebar="content"]')!.className).not.toMatch(/\binvisible\b/);
    });
  });

  it("hides the Create new button from someone who may create nothing", () => {
    permissionsMock.mockReturnValue({
      can: (_r: string, action?: string) => action !== "create",
      isTechnician: false,
      isLoading: false,
    });
    renderSidebar();

    expect(screen.queryByRole("button", { name: /create new/i })).not.toBeInTheDocument();
  });

  it("hides rows a user cannot view", () => {
    // Can view deals/contacts only.
    permissionsMock.mockReturnValue({
      can: (r: string) => r === "deals" || r === "contacts",
      isTechnician: false,
      isLoading: false,
    });
    renderSidebar();

    expect(screen.getByText("Jobs")).toBeInTheDocument();
    expect(screen.getByText("Clients")).toBeInTheDocument();
    expect(screen.queryByText("Inventory")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
  });

  it("shows Inventory when the user can view any inventory resource", () => {
    permissionsMock.mockReturnValue({
      can: (r: string) => r === "warehouses",
      isTechnician: false,
      isLoading: false,
    });
    renderSidebar();

    expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/inventory");
  });

  it("renders the minimal technician shell", () => {
    permissionsMock.mockReturnValue({ can: () => false, isTechnician: true, isLoading: false });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^my jobs$/i })).toHaveAttribute("href", "/my-jobs");
    expect(screen.getByText("My Profile")).toBeInTheDocument();
    // The van is gated on containers.view, which this technician doesn't hold.
    expect(screen.queryByText("My Stock")).not.toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Clients")).not.toBeInTheDocument();
    expect(screen.queryByText("Features")).not.toBeInTheDocument();
  });

  it("offers the technician their own stock once they may view containers", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "containers", isTechnician: true, isLoading: false });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^my stock$/i })).toHaveAttribute("href", "/my-stock");
  });

  it("gives technicians a Messages item once they may view messages", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "messages", isTechnician: true, isLoading: false });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^messages$/i })).toHaveAttribute("href", "/messages");
  });

  it("shows Messages beside the phone with the unread count as a badge", () => {
    allowAll();
    countersMock.mockReturnValue({ data: { unreadConversations: 7 } });
    renderSidebar();

    expect(screen.getByRole("link", { name: /^messages$/i })).toHaveAttribute("href", "/messages");
    expect(screen.getByLabelText("7 unread conversations")).toHaveTextContent("7");
    const links = navLinks();
    expect(links.indexOf("Messages")).toBe(links.indexOf("BitCRM Phone") + 1);
  });

  it("keeps the Messages item plain when nothing is unread", () => {
    allowAll();
    countersMock.mockReturnValue({ data: { unreadConversations: 0 } });
    renderSidebar();

    expect(screen.queryByLabelText(/unread conversation/)).not.toBeInTheDocument();
  });

  /**
   * Workiz draws a rule under its logo, so the brand reads as a header rather
   * than as the first row of the menu.
   */
  it("separates the logo from the menu with a rule", () => {
    allowAll();
    renderSidebar();

    const rule = document.querySelector('[data-slot="brand-rule"]');
    expect(rule).not.toBeNull();
  });

  it("keeps the rule full width so nothing shifts as the sidebar collapses", () => {
    allowAll();
    renderSidebar();

    const rule = document.querySelector('[data-slot="brand-rule"]');
    // A margin that changes with the state would make the line jump while the
    // width animates — the same trap the logo padding avoids.
    expect(rule?.className).not.toMatch(/group-data-\[collapsible=icon\]:(mx|px|ml|mr)-/);
  });

  /**
   * The rule has to land on the same line as the app header's bottom border,
   * or the two sit a few pixels apart and the whole top of the screen looks
   * crooked. The header is h-14 (56px); the sidebar header pads by 8px, so the
   * brand row must be exactly 48px for the rule to meet it.
   */
  it("puts the rule exactly where the header's border is", () => {
    allowAll();
    renderSidebar();

    const brand = screen.getByLabelText("Shmorkiz home");
    expect(brand.className).toContain("h-12"); // 48px + the header's p-2 = 56px
  });
});
