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

  it("puts User containers after Containers, on the containers permission", () => {
    permissionsMock.mockReturnValue({ can: (r: string) => r === "containers" });
    pathnameMock.mockReturnValue("/inventory/containers");
    render(<InventoryTabs />);

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Containers",
      "User containers",
    ]);
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
});
