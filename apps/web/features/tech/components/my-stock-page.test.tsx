import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, type Container } from "@bitcrm/types";
import type { EnrichedStockRow } from "@/features/inventory/warehouses/lib";
import { MyStockPage } from "./my-stock-page";

const can = vi.fn((resource: string) => resource === "containers");
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can, isTechnician: true, isLoading: false }),
}));

const container = vi.fn();
const stockView = vi.fn();
vi.mock("@/features/inventory/containers/hooks", () => ({
  useMyContainer: () => container(),
  useContainerStockView: () => stockView(),
}));

const VAN: Container = {
  id: "c1",
  name: "Van 12",
  department: "Field",
  status: InventoryStatus.ACTIVE,
  technicianId: "t1",
  createdAt: "",
  updatedAt: "",
};

const ROWS: EnrichedStockRow[] = [
  { productId: "p1", name: "Key blank", sku: "KEY-1", category: "Keys", quantity: 120, isLow: false },
  { productId: "p2", name: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 2, minLevel: 10, isLow: true },
];

function stock(over: Record<string, unknown> = {}) {
  return {
    rows: ROWS,
    summary: { skuCount: 2, totalUnits: 122, totalValue: 0, lowCount: 1 },
    isLoading: false,
    isError: false,
    joinReady: true,
    ...over,
  };
}

describe("MyStockPage", () => {
  beforeEach(() => {
    can.mockImplementation((resource: string) => resource === "containers");
    container.mockReturnValue({ data: VAN, isLoading: false, isError: false });
    stockView.mockReturnValue(stock());
  });

  it("refuses a viewer who may not see containers", () => {
    can.mockReturnValue(false);
    render(<MyStockPage />);
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  it("tells a technician with no van who to ask", () => {
    container.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<MyStockPage />);

    expect(screen.getByText("No van assigned")).toBeInTheDocument();
    expect(screen.getByText(/ask the office/i)).toBeInTheDocument();
  });

  it("names the van and counts what's on it", () => {
    render(<MyStockPage />);

    expect(screen.getByText("Van 12 · Field")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("122 on hand")).toBeInTheDocument();
    expect(screen.getByText("1 low")).toBeInTheDocument();
  });

  it("floats low stock to the top and marks it", () => {
    render(<MyStockPage />);

    const rows = screen.getAllByTestId("my-stock-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Deadbolt");
    expect(rows[0]).toHaveTextContent("Low");
    expect(rows[1]).toHaveTextContent("Key blank");
  });

  it("filters as the technician types, and says so when nothing matches", async () => {
    render(<MyStockPage />);
    const search = screen.getByTestId("my-stock-search");

    await userEvent.type(search, "key");
    expect(screen.getAllByTestId("my-stock-row")).toHaveLength(1);
    expect(screen.getByText("Key blank")).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "chainsaw");
    expect(screen.queryAllByTestId("my-stock-row")).toHaveLength(0);
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("calls an empty van empty, not broken", () => {
    stockView.mockReturnValue(stock({ rows: [], summary: { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 } }));
    render(<MyStockPage />);

    expect(screen.getByText("Empty van")).toBeInTheDocument();
  });

  it("says so when the stock could not be loaded", () => {
    stockView.mockReturnValue(stock({ isError: true, rows: [] }));
    render(<MyStockPage />);

    expect(screen.getByText(/couldn't load your stock/i)).toBeInTheDocument();
  });
});
