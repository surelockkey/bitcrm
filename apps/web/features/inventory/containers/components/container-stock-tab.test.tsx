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

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("ContainerStockTab — a stable first frame", () => {
  const table = (readOnly = false) =>
    render(<ContainerStockTab containerId="c1" readOnly={readOnly} onMove={vi.fn()} />)
      .container;

  it("lays the columns out at declared widths, not by content", () => {
    expect(table().querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const c = table();
    const cols = [...c.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(c.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  // Колонка дій зникає в режимі перегляду — `<colgroup>` має зникнути з нею,
  // інакше ширини поїдуть на одну колонку вбік.
  it("drops the actions column from the colgroup when read-only", () => {
    const c = table(true);
    expect(c.querySelectorAll("colgroup col")).toHaveLength(
      c.querySelectorAll("thead th").length,
    );
    expect(screen.queryByTestId("resize-actions")).not.toBeInTheDocument();
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
    for (const id of ["product", "category", "onHand", "unit", "value", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
