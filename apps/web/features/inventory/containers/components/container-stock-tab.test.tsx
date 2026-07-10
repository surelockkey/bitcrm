import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EnrichedStockRow } from "@/features/inventory/warehouses/lib";
import { ContainerStockTab } from "./container-stock-tab";

const rows: EnrichedStockRow[] = [
  { productId: "p1", name: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 6, unitPrice: 45, value: 270, minLevel: 10, isLow: true },
  { productId: "p2", name: "Key blank", sku: "KEY-1", category: "Keys", quantity: 120, unitPrice: 3, value: 360, minLevel: 0, isLow: false },
];

vi.mock("../hooks", () => ({
  useContainerStockView: () => ({
    rows,
    summary: { skuCount: 2, totalUnits: 126, totalValue: 630, lowCount: 1 },
    isLoading: false,
    isError: false,
    joinReady: true,
  }),
}));

describe("ContainerStockTab", () => {
  it("renders joined rows with value and a low-stock chip", () => {
    render(<ContainerStockTab containerId="c1" readOnly />);
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(screen.getByText("$270.00")).toBeInTheDocument();
    expect(screen.getByText("6 · low")).toBeInTheDocument();
  });

  it("fires onMove for a row when not read-only", async () => {
    const onMove = vi.fn();
    render(<ContainerStockTab containerId="c1" onMove={onMove} />);
    const moveButtons = screen.getAllByText("Move ↗");
    await userEvent.click(moveButtons[0]);
    expect(onMove).toHaveBeenCalledWith({ productId: "p1", productName: "Deadbolt", onHand: 6 });
  });
});
