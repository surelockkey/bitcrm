import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryTabs } from "./inventory-tabs";

const pathnameMock = vi.fn(() => "/inventory/items");
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

const permissionsMock = vi.fn();
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => permissionsMock(),
}));

describe("InventoryTabs", () => {
  it("renders one tab per inventory section with its route", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    render(<InventoryTabs />);

    expect(screen.getByRole("link", { name: "Items" })).toHaveAttribute(
      "href",
      "/inventory/items",
    );
    expect(screen.getByRole("link", { name: "Warehouses" })).toHaveAttribute(
      "href",
      "/inventory/warehouses",
    );
    expect(screen.getByRole("link", { name: "Containers" })).toHaveAttribute(
      "href",
      "/inventory/containers",
    );
    expect(screen.getByRole("link", { name: "Transfers" })).toHaveAttribute(
      "href",
      "/inventory/transfers",
    );
  });

  it("puts User containers and Templates after Containers, on the containers permission", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "containers" });
    pathnameMock.mockReturnValue("/inventory/containers");
    render(<InventoryTabs />);

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Containers",
      "User containers",
      "Templates",
    ]);
    expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute("href", "/inventory/templates");
    expect(screen.getByRole("link", { name: "User containers" })).toHaveAttribute(
      "href",
      "/inventory/user-containers",
    );
    // "/inventory/user-containers" is not "/inventory/containers".
    expect(screen.getByRole("link", { name: "User containers" })).not.toHaveAttribute("aria-current");
  });

  it("lists the sections in Workiz's order", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    render(<InventoryTabs />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Items",
      "Warehouses",
      "Containers",
      "User containers",
      "Templates",
      "Transfers",
    ]);
  });

  it("marks the tab matching the current pathname as current", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    pathnameMock.mockReturnValue("/inventory/warehouses");
    render(<InventoryTabs />);

    expect(screen.getByRole("link", { name: "Warehouses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Items" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("hides tabs for resources the user cannot view", () => {
    permissionsMock.mockReturnValue({
      can: (r: string) => r === "containers",
    });
    render(<InventoryTabs />);

    expect(screen.getByRole("link", { name: "Containers" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Items" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Warehouses" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Transfers" }),
    ).not.toBeInTheDocument();
  });

  // Before the permissions answered the row was empty; when they did, the
  // tabs appeared and pushed every Inventory screen down by 30px.
  it("holds every tab's place while permissions load, without linking anywhere yet", () => {
    permissionsMock.mockReturnValue({ can: () => false, isLoading: true });
    render(<InventoryTabs />);

    const nav = screen.getByRole("navigation", { name: "Inventory sections" });
    expect(nav).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(nav.querySelectorAll("[data-tab-placeholder]")).toHaveLength(6);
  });

  it("a placeholder is a tab's own shape — same padding and underline", () => {
    permissionsMock.mockReturnValue({ can: () => true });
    const { unmount } = render(<InventoryTabs />);
    const tab = screen.getByRole("link", { name: "Items" }).className;
    unmount();

    permissionsMock.mockReturnValue({ can: () => false, isLoading: true });
    render(<InventoryTabs />);
    const placeholder = document.querySelector("[data-tab-placeholder]") as HTMLElement;
    for (const cls of ["border-b-2", "pb-2", "text-sm", "whitespace-nowrap"]) {
      expect(tab.split(" ")).toContain(cls);
      expect(placeholder.className.split(" ")).toContain(cls);
    }
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
      expect(link.className).toMatch(/flex-none/);
    }
  });
});
