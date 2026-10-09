import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceBookTabs } from "./price-book-tabs";

const mocks = vi.hoisted(() => ({
  pathname: "/price-book/items",
  can: (() => true) as (resource: string) => boolean,
  loading: false,
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: mocks.can, isLoading: mocks.loading }),
}));

const labels = () => screen.getAllByRole("link").map((a) => a.textContent);

beforeEach(() => {
  mocks.pathname = "/price-book/items";
  mocks.can = () => true;
  mocks.loading = false;
});

describe("PriceBookTabs", () => {
  it("lists Workiz's tabs we have — Items & products · Item categories · Item brands — each with its route", () => {
    render(<PriceBookTabs />);
    expect(labels()).toEqual(["Items & products", "Item categories", "Item brands"]);
    expect(screen.getByRole("link", { name: "Items & products" })).toHaveAttribute("href", "/price-book/items");
    expect(screen.getByRole("link", { name: "Item categories" })).toHaveAttribute("href", "/price-book/categories");
    expect(screen.getByRole("link", { name: "Item brands" })).toHaveAttribute("href", "/price-book/brands");
  });

  it("draws Workiz's big tabs (16px, the 4px bar under the open one)", () => {
    render(<PriceBookTabs />);
    expect(screen.getByRole("link", { name: "Items & products" }).className).toContain("text-base");
  });

  it("holds the three places while the permissions load", () => {
    mocks.loading = true;
    render(<PriceBookTabs />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.querySelectorAll("[data-tab-placeholder]")).toHaveLength(3);
  });

  // The frame over the tabs holds them until the page under them is whole
  // (one skeleton, then the page), permissions in or not.
  it("holds the three places while the frame says so", () => {
    render(<PriceBookTabs pending />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.querySelectorAll("[data-tab-placeholder]")).toHaveLength(3);
    expect(screen.getByRole("navigation", { name: "Price Book sections" })).toHaveAttribute("aria-busy", "true");
  });

  it("gates each tab on its own resource", () => {
    mocks.can = (r) => r === "products";
    const { unmount } = render(<PriceBookTabs />);
    expect(labels()).toEqual(["Items & products"]);
    unmount();

    mocks.can = (r) => r === "product_categories";
    const second = render(<PriceBookTabs />);
    expect(labels()).toEqual(["Item categories"]);
    second.unmount();

    mocks.can = (r) => r === "brands";
    render(<PriceBookTabs />);
    expect(labels()).toEqual(["Item brands"]);
  });

  it("marks the tab of the current route", () => {
    mocks.pathname = "/price-book/brands";
    render(<PriceBookTabs />);
    expect(screen.getByRole("link", { name: "Item brands" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Items & products" })).not.toHaveAttribute("aria-current");
  });

  it("names its nav for a screen reader", () => {
    render(<PriceBookTabs />);
    expect(screen.getByRole("navigation", { name: "Price Book sections" })).toBeInTheDocument();
  });
});
