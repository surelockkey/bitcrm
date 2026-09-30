import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import ItemPage from "./[id]/page";
import NewItemPage from "./new/page";
import ProductHitPage from "../products/[id]/page";

/**
 * Items have no page of their own any more — they open as popups on the Items
 * tab. Links already out there (bookmarks, old notes, the search index's
 * `/inventory/products/<id>`) still have to land on the item.
 */
describe("old item URLs", () => {
  beforeEach(() => redirect.mockReset());

  it("sends /inventory/items/<id> to its Edit popup", async () => {
    await ItemPage({ params: Promise.resolve({ id: "p1" }) });
    expect(redirect).toHaveBeenCalledWith("/inventory/items?edit=p1");
  });

  it("encodes the id rather than trusting it", async () => {
    await ItemPage({ params: Promise.resolve({ id: "a b&new=1" }) });
    expect(redirect).toHaveBeenCalledWith("/inventory/items?edit=a%20b%26new%3D1");
  });

  it("sends /inventory/items/new to the New item popup", () => {
    NewItemPage();
    expect(redirect).toHaveBeenCalledWith("/inventory/items?new=1");
  });

  it("sends a search hit's /inventory/products/<id> to the item's Edit popup", async () => {
    await ProductHitPage({ params: Promise.resolve({ id: "p1" }) });
    expect(redirect).toHaveBeenCalledWith("/inventory/items?edit=p1");
  });
});
