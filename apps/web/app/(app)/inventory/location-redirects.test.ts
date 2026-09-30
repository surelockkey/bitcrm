import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import ContainerPage from "./containers/[id]/page";
import WarehousePage from "./warehouses/[id]/page";

/**
 * Vans and warehouses have no page of their own any more — their stock and
 * their settings open as popups on the tab. Links already out there (the
 * search index, bookmarks, the old Edit button's `?tab=settings`) still land.
 */
describe("old container and warehouse URLs", () => {
  beforeEach(() => redirect.mockReset());

  const props = (id: string, search: Record<string, string> = {}) => ({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(search),
  });

  it("sends /inventory/containers/<id> to the van's stock popup", async () => {
    await ContainerPage(props("c1"));
    expect(redirect).toHaveBeenCalledWith("/inventory/containers?stock=c1");
  });

  it("sends /inventory/warehouses/<id> to the warehouse's stock popup", async () => {
    await WarehousePage(props("w1"));
    expect(redirect).toHaveBeenCalledWith("/inventory/warehouses?stock=w1");
  });

  it("sends the settings tab to the Edit popup", async () => {
    await WarehousePage(props("w1", { tab: "settings" }));
    expect(redirect).toHaveBeenCalledWith("/inventory/warehouses?edit=w1");
    await ContainerPage(props("c1", { tab: "settings" }));
    expect(redirect).toHaveBeenCalledWith("/inventory/containers?edit=c1");
  });

  it("encodes the id rather than trusting it", async () => {
    await ContainerPage(props("a b&edit=1"));
    expect(redirect).toHaveBeenCalledWith("/inventory/containers?stock=a%20b%26edit%3D1");
  });
});
