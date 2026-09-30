import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import ItemPage from "./items/[id]/page";
import NewItemPage from "./items/new/page";
import ProductHitPage from "./products/[id]/page";
import WarehousePage from "./warehouses/[id]/page";
import ContainerPage from "./containers/[id]/page";

/**
 * Items, warehouses and vans have no page of their own, and no address opens
 * a popup (the owner's call): links already out there — bookmarks, old notes,
 * the search index — land on the plain list of their tab, nothing open.
 */
describe("old item, warehouse and container URLs", () => {
  beforeEach(() => redirect.mockReset());

  it.each([
    ["/inventory/items/<id>", ItemPage, "/inventory/items"],
    ["/inventory/items/new", NewItemPage, "/inventory/items"],
    ["/inventory/products/<id>", ProductHitPage, "/inventory/items"],
    ["/inventory/warehouses/<id>", WarehousePage, "/inventory/warehouses"],
    ["/inventory/containers/<id>", ContainerPage, "/inventory/containers"],
  ])("sends %s to the plain list", (_, Page, list) => {
    Page();
    expect(redirect).toHaveBeenCalledWith(list);
  });
});
