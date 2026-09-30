import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The lists have suites of their own; here only which popup a link opens them with.
vi.mock("@/features/inventory/containers/components/containers-page", () => ({
  ContainersPage: ({ initialPopup }: { initialPopup?: unknown }) => (
    <div data-testid="list" data-popup={JSON.stringify(initialPopup ?? null)} />
  ),
}));
vi.mock("@/features/inventory/warehouses/components/warehouses-page", () => ({
  WarehousesPage: ({ initialPopup }: { initialPopup?: unknown }) => (
    <div data-testid="list" data-popup={JSON.stringify(initialPopup ?? null)} />
  ),
}));
vi.mock("@/features/inventory/components/tab-fallback", () => ({ TabFallback: () => null }));

import ContainerPage from "./containers/[id]/page";
import WarehousePage from "./warehouses/[id]/page";

const popup = () => JSON.parse(screen.getByTestId("list").dataset.popup ?? "null");

/**
 * Vans and warehouses have no page of their own — their stock and their
 * settings open as popups over the tab, from its state. Links already out
 * there (the search index, bookmarks, the old Edit button's `?tab=settings`)
 * render the list with the popup open.
 */
describe("links to a container or a warehouse", () => {
  const props = (id: string, search: Record<string, string> = {}) => ({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(search),
  });

  it("renders /inventory/containers/<id> as the fleet with the van's stock open", async () => {
    render(await ContainerPage(props("c1")));
    expect(popup()).toEqual({ kind: "stock", id: "c1" });
  });

  it("renders /inventory/warehouses/<id> as the list with the warehouse's stock open", async () => {
    render(await WarehousePage(props("w1")));
    expect(popup()).toEqual({ kind: "stock", id: "w1" });
  });

  it("opens the Edit popup for the old settings tab", async () => {
    const warehouse = render(await WarehousePage(props("w1", { tab: "settings" })));
    expect(popup()).toEqual({ kind: "edit", id: "w1" });
    warehouse.unmount();
    render(await ContainerPage(props("c1", { tab: "settings" })));
    expect(popup()).toEqual({ kind: "edit", id: "c1" });
  });
});
