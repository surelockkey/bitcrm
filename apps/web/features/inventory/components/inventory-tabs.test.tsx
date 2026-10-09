import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryTabs } from "./inventory-tabs";

const pathnameMock = vi.fn(() => "/inventory/items");
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const permissionsMock = vi.fn();
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => permissionsMock(),
}));

/** The links' words, counters left out. */
const names = () => screen.getAllByRole("link").map((a) => a.firstChild?.textContent);

describe("InventoryTabs", () => {
  it("renders one tab per inventory section with its route", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    render(<InventoryTabs />);

    expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute("href", "/inventory/items");
    expect(screen.getByRole("link", { name: "User locations" })).toHaveAttribute("href", "/inventory/user-containers");
    expect(screen.getByRole("link", { name: "Warehouses" })).toHaveAttribute("href", "/inventory/warehouses");
    expect(screen.getByRole("link", { name: "Containers" })).toHaveAttribute("href", "/inventory/containers");
    expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute("href", "/inventory/templates");
    expect(screen.getByRole("link", { name: "Transfers" })).toHaveAttribute("href", "/inventory/transfers");
  });

  // Workiz: Inventory, User locations, Locations (ours: Warehouses and
  // Containers, the owner's split); then BitCRM's own Templates and Transfers.
  it("lists the sections in Workiz's order and words", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    render(<InventoryTabs />);
    expect(names()).toEqual(["Inventory", "User locations", "Warehouses", "Containers", "Templates", "Transfers"]);
  });

  it("puts User locations and Templates on the containers permission", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "containers" });
    pathnameMock.mockReturnValue("/inventory/containers");
    render(<InventoryTabs />);

    expect(names()).toEqual(["User locations", "Containers", "Templates"]);
    // "/inventory/user-containers" is not "/inventory/containers".
    expect(screen.getByRole("link", { name: "User locations" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Containers" })).toHaveAttribute("aria-current", "page");
  });

  it("marks the tab matching the current pathname as current", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    pathnameMock.mockReturnValue("/inventory/warehouses");
    render(<InventoryTabs />);

    expect(screen.getByRole("link", { name: "Warehouses" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Inventory" })).not.toHaveAttribute("aria-current");
  });

  it("hides tabs for resources the user cannot view", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "containers" });
    render(<InventoryTabs />);

    expect(screen.queryByRole("link", { name: "Inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Warehouses" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Transfers" })).not.toBeInTheDocument();
  });

  // Workiz's Tabs-module counters: "Inventory 99+", "Locations 94".
  it("prints each tab's counter, 99+ past ninety-nine", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    pathnameMock.mockReturnValue("/inventory/items");
    render(<InventoryTabs counts={{ items: 3106, warehouses: 3, containers: 91, transfers: 0 }} />);

    expect(screen.getByRole("link", { name: "Inventory 99+" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Warehouses 3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Containers 91" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Transfers 0" })).toBeInTheDocument();
    // No count asked or answered: no counter.
    expect(screen.getByRole("link", { name: "Templates" })).toBeInTheDocument();
  });

  // Before the permissions answered the row was empty; when they did, the
  // tabs appeared and pushed every Inventory screen down by 30px. Until the
  // page under it is whole the row holds its place the same way, so its
  // counters arrive with the page instead of sliding the tabs about.
  it.each([
    ["the permissions load", { can: (): boolean => false, isLoading: true }, false],
    ["the page under it is not whole yet", { can: (): boolean => true }, true],
  ])("holds every tab's place while %s, without linking anywhere yet", (_, perms, pending) => {
    permissionsMock.mockReturnValue(perms);
    render(<InventoryTabs pending={pending} />);

    const nav = screen.getByRole("navigation", { name: "Inventory sections" });
    expect(nav).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(nav.querySelectorAll("[data-tab-placeholder]")).toHaveLength(6);
  });

  // On a 390px phone the six tabs made the page 510px wide: every popup was
  // laid out that wide and cut off on the right.
  it("scrolls its own row sideways on a narrow screen instead of widening the page", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    render(<InventoryTabs />);

    const nav = screen.getByRole("navigation", { name: "Inventory sections" });
    expect(nav.className).toMatch(/overflow-x-auto/);
    expect(nav.className).toMatch(/max-w-full/);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toMatch(/whitespace-nowrap/);
      expect(link.className).toMatch(/shrink-0/);
    }
  });
});
