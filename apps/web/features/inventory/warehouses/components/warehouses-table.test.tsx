import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { StockSummary } from "../lib";
import { WarehousesTable } from "./warehouses-table";

const onEdit = vi.fn();
const onStock = vi.fn();
const summaries: Record<string, StockSummary> = {};

vi.mock("../hooks", () => ({
  useWarehouseStockView: (id: string) => ({
    summary:
      summaries[id] ?? { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 },
    isLoading: false,
  }),
}));

function warehouse(over: Partial<Warehouse>): Warehouse {
  return {
    id: "w1",
    name: "WAREHOUSE TX",
    address: "800 W Campbell Rd",
    description: "RICHARDSON SHOP",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function renderTable(warehouses: Warehouse[] = [warehouse({})]) {
  return render(
    <TooltipProvider>
      <WarehousesTable warehouses={warehouses} onEdit={onEdit} onStock={onStock} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  onEdit.mockClear();
  onStock.mockClear();
  for (const k of Object.keys(summaries)) delete summaries[k];
});

describe("WarehousesTable", () => {
  it("has Workiz's columns, in order", () => {
    renderTable();
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Name",
      "Description",
      "Items",
      "Actions",
    ]);
  });

  it("renders name, description and total units", () => {
    summaries.w1 = { skuCount: 12, totalUnits: 36498, totalValue: 900, lowCount: 0 };
    renderTable();
    expect(screen.getByText("WAREHOUSE TX")).toBeInTheDocument();
    expect(screen.getByText("RICHARDSON SHOP")).toBeInTheDocument();
    expect(screen.getByText("36,498")).toBeInTheDocument();
  });

  it("falls back to the address when there is no description", () => {
    renderTable([warehouse({ description: undefined })]);
    expect(screen.getByText("800 W Campbell Rd")).toBeInTheDocument();
  });

  it("left-aligns everything — headers, cells, numbers and the actions", () => {
    renderTable();
    for (const el of document.querySelectorAll("th, td, td *")) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/text-right|justify-end/);
    }
  });

  it("shows a Low stock badge only when something is low", () => {
    summaries.w1 = { skuCount: 3, totalUnits: 758, totalValue: 100, lowCount: 2 };
    const { unmount } = renderTable();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    unmount();

    renderTable([warehouse({ id: "w2" })]);
    expect(screen.queryByText("Low stock")).not.toBeInTheDocument();
  });

  it("opens the warehouse's stock on row click", async () => {
    renderTable();
    await userEvent.click(screen.getByText("WAREHOUSE TX"));
    expect(onStock).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the Edit popup from the pencil, without also opening the stock", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Edit WAREHOUSE TX" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }));
    expect(onStock).not.toHaveBeenCalled();
  });

  it("opens the stock popup from the box button, once", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Stock in WAREHOUSE TX" }));
    expect(onStock).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("keeps Archive off the row — it lives in the Edit popup", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("WarehousesTable — a stable first frame", () => {
  const table = () => renderTable().container;

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
    for (const id of ["name", "description", "items", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
