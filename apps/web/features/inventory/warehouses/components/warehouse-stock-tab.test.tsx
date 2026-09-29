import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarehouseStockTab } from "./warehouse-stock-tab";
import type { EnrichedStockRow } from "../lib";

const rows: EnrichedStockRow[] = [
  { productId: "p1", name: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 240, unitPrice: 45, value: 10800, minLevel: 10, isLow: false },
  { productId: "p2", name: "Key blank", sku: "KEY-1", category: "Keys", quantity: 8, unitPrice: 22, value: 176, minLevel: 10, isLow: true },
];

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useWarehouseStockView: () => ({
    rows,
    summary: { skuCount: 2, totalUnits: 248, totalValue: 10976, lowCount: 1 },
    isLoading: false,
    isError: false,
    joinReady: true,
  }),
}));

describe("WarehouseStockTab", () => {
  it("renders joined rows with value and a low-stock chip", () => {
    render(<WarehouseStockTab warehouseId="w1" onTransfer={() => {}} />);
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(screen.getByText("LOCK-1")).toBeInTheDocument();
    expect(screen.getByText("$10,800.00")).toBeInTheDocument();
    expect(screen.getByText("8 · low")).toBeInTheDocument(); // low chip
  });

  it("shows summary totals", () => {
    render(<WarehouseStockTab warehouseId="w1" onTransfer={() => {}} />);
    // On-hand total appears in both the stat card and the table footer.
    expect(screen.getAllByText("248").length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("WarehouseStockTab — a stable first frame", () => {
  const table = () =>
    render(<WarehouseStockTab warehouseId="w1" onTransfer={() => {}} />).container;

  it("lays the columns out at declared widths, not by content", () => {
    expect(table().querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const c = table();
    const cols = [...c.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(c.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  // `min-w` на комірці б'є оголошену ширину й зсуває рядок убік.
  it("leaves the width to the column — no cell sets one of its own", () => {
    for (const el of table().querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/(^|\s)(min-)?w-/);
    }
  });

  it("clips every cell rather than letting it spill into the next column", () => {
    for (const td of table().querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
  });

  it("offers a drag handle on every header", () => {
    table();
    for (const id of ["product", "category", "onHand", "unit", "value", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
