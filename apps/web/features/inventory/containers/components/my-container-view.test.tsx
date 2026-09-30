import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  mine: { isLoading: false, isError: false, data: undefined as Container | undefined },
  stockFor: [] as string[],
}));

vi.mock("../hooks", () => ({
  useMyContainer: () => mocks.mine,
  useContainerStockView: (id: string) => {
    mocks.stockFor.push(id);
    return {
      rows: [
        { productId: "p1", name: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 6, unitPrice: 45, value: 270, minLevel: 0, isLow: false },
      ],
      summary: { skuCount: 1, totalUnits: 6, totalValue: 270, lowCount: 0 },
      isLoading: false,
      isError: false,
    };
  },
}));

import { MyContainerView } from "./my-container-view";

beforeEach(() => {
  mocks.stockFor = [];
  mocks.mine = {
    isLoading: false,
    isError: false,
    data: { id: "c7", name: "Taras's van", department: "North", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" },
  };
});

/** The technician's own van stays a plain read-only page — no popups, no moves. */
describe("MyContainerView", () => {
  it("shows the technician's own van and what is on it", () => {
    render(<MyContainerView />);
    expect(screen.getByRole("heading", { name: "My Container" })).toBeInTheDocument();
    expect(screen.getByText(/North/)).toBeInTheDocument();
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(mocks.stockFor).toContain("c7");
  });

  it("offers nothing to change", () => {
    render(<MyContainerView />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when no van is assigned", () => {
    mocks.mine = { isLoading: false, isError: true, data: undefined };
    render(<MyContainerView />);
    expect(screen.getByText("No container assigned")).toBeInTheDocument();
  });

  // Found in one frame and filled in the next, the page's header grew and a
  // grey block turned into cards and a table.
  it("while the van is found, draws its own header and the shelf's frame", () => {
    mocks.mine = { isLoading: true, isError: false, data: undefined };
    render(<MyContainerView />);
    expect(screen.getByTestId("my-container-header")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("stat-skeleton")).toHaveLength(3);
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
  });

  it("has the same header, loading and loaded", () => {
    const loaded = render(<MyContainerView />);
    const shape = screen.getByTestId("my-container-header").className;
    loaded.unmount();
    mocks.mine = { isLoading: true, isError: false, data: undefined };
    render(<MyContainerView />);
    expect(screen.getByTestId("my-container-header").className).toBe(shape);
  });
});
