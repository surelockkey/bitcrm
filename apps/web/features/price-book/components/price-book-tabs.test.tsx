import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceBookTabs } from "./price-book-tabs";

const mocks = vi.hoisted(() => ({
  pathname: "/price-book/items",
  can: (() => true) as (resource: string) => boolean,
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: mocks.can }),
}));

const labels = () => screen.getAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  mocks.pathname = "/price-book/items";
  mocks.can = () => true;
});

describe("PriceBookTabs", () => {
  it("lists Items · Categories · Brands, each with its route", () => {
    render(<PriceBookTabs />);
    expect(labels()).toEqual(["Items", "Categories", "Brands"]);
    expect(screen.getByRole("link", { name: "Items" })).toHaveAttribute("href", "/price-book/items");
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute("href", "/price-book/categories");
    expect(screen.getByRole("link", { name: "Brands" })).toHaveAttribute("href", "/price-book/brands");
  });

  it("gates each tab on its own resource", () => {
    mocks.can = (r) => r === "products";
    const { unmount } = render(<PriceBookTabs />);
    expect(labels()).toEqual(["Items"]);
    unmount();

    mocks.can = (r) => r === "product_categories";
    const second = render(<PriceBookTabs />);
    expect(labels()).toEqual(["Categories"]);
    second.unmount();

    mocks.can = (r) => r === "brands";
    render(<PriceBookTabs />);
    expect(labels()).toEqual(["Brands"]);
  });

  it("marks the tab of the current route", () => {
    mocks.pathname = "/price-book/brands";
    render(<PriceBookTabs />);
    expect(screen.getByRole("link", { name: "Brands" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Items" })).not.toHaveAttribute("aria-current");
  });

  it("names its nav for a screen reader", () => {
    render(<PriceBookTabs />);
    expect(screen.getByRole("navigation", { name: "Price Book sections" })).toBeInTheDocument();
  });
});
