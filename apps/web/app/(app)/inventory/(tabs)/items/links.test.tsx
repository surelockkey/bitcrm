import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
// The list has suites of its own; here only which popup a link opens it with.
vi.mock("@/features/inventory/products/components/products-page", () => ({
  ProductsPage: ({ initialPopup }: { initialPopup?: unknown }) => (
    <div data-testid="items-list" data-popup={JSON.stringify(initialPopup ?? null)} />
  ),
}));
vi.mock("@/features/inventory/components/tab-fallback", () => ({ TabFallback: () => null }));

import ItemPage from "./[id]/page";
import NewItemPage from "./new/page";
import ProductHitPage from "../../products/[id]/page";

const popup = () => JSON.parse(screen.getByTestId("items-list").dataset.popup ?? "null");

/**
 * Items have no page of their own — they open as popups over the Items tab,
 * from its state. Links already out there (bookmarks, old notes, the search
 * index's `/inventory/products/<id>`) render the list with the popup open —
 * with nothing in the query.
 */
describe("links to an item", () => {
  beforeEach(() => redirect.mockReset());

  it("renders /inventory/items/<id> as the list with the item's Edit popup open", async () => {
    render(await ItemPage({ params: Promise.resolve({ id: "p1" }) }));
    expect(popup()).toEqual({ kind: "edit", id: "p1" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("hands the id over as it is — it never becomes part of a query", async () => {
    render(await ItemPage({ params: Promise.resolve({ id: "a b&new=1" }) }));
    expect(popup()).toEqual({ kind: "edit", id: "a b&new=1" });
  });

  it("renders /inventory/items/new as the list with the New item popup open", () => {
    render(NewItemPage());
    expect(popup()).toEqual({ kind: "new" });
  });

  it("sends a search hit's /inventory/products/<id> to the item's own address", async () => {
    await ProductHitPage({ params: Promise.resolve({ id: "p1" }) });
    expect(redirect).toHaveBeenCalledWith("/inventory/items/p1");
  });

  it("encodes the id in that address rather than trusting it", async () => {
    await ProductHitPage({ params: Promise.resolve({ id: "a b/c" }) });
    expect(redirect).toHaveBeenCalledWith("/inventory/items/a%20b%2Fc");
  });
});
