import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

/** The technician's own van: what is on it, read-only. */
describe("ContainerStockTab", () => {
  it("renders joined rows with value and a low-stock chip", () => {
    render(<ContainerStockTab containerId="c1" />);
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(screen.getByText("$270.00")).toBeInTheDocument();
    expect(screen.getByText("6 · low")).toBeInTheDocument();
  });

  it("is read-only — no actions column, no buttons", () => {
    render(<ContainerStockTab containerId="c1" />);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Product",
      "Category",
      "On hand",
      "Unit",
      "Value",
    ]);
    expect(screen.queryByRole("button", { name: /move/i })).toBeNull();
  });

  it("left-aligns everything, numbers and money included", () => {
    render(<ContainerStockTab containerId="c1" />);
    for (const el of document.querySelectorAll("th, td")) {
      expect(el.className).not.toMatch(/text-right/);
    }
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("ContainerStockTab — a stable first frame", () => {
  const table = () => render(<ContainerStockTab containerId="c1" />).container;

  it("scrolls sideways instead of clipping when the columns outgrow the screen", () => {
    const frame = table().querySelector("[data-slot=table-frame]") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toMatch(/overflow-x-auto/);
    expect(frame.className).not.toMatch(/overflow-hidden/);
  });

  it("lays the columns out at declared widths, not by content", () => {
    expect(table().querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const c = table();
    const cols = [...c.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(c.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

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
    for (const id of ["product", "category", "onHand", "unit", "value"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
