import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import type { StockSummary } from "@/features/inventory/warehouses/lib";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ContainersTable } from "./containers-table";

const summaries: Record<string, StockSummary> = {};
const stockAskedFor: string[] = [];
const onEdit = vi.fn();
const onStock = vi.fn();

vi.mock("../hooks", () => ({
  useContainerStockView: (id: string) => {
    stockAskedFor.push(id);
    return {
      summary: summaries[id] ?? { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 },
      isLoading: false,
    };
  },
}));

function container(over: Partial<Container>): Container {
  return {
    id: "c1",
    name: "Van 1",
    description: "Ford Transit",
    technicianId: "t1",
    technicianName: "TYLER BOUCHER",
    department: "Connecticut",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function renderTable(containers: Container[] = [container({})]) {
  return render(
    <TooltipProvider>
      <ContainersTable containers={containers} onEdit={onEdit} onStock={onStock} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  onEdit.mockClear();
  onStock.mockClear();
  stockAskedFor.length = 0;
  for (const k of Object.keys(summaries)) delete summaries[k];
});

describe("ContainersTable", () => {
  it("has Workiz's columns, in order", () => {
    renderTable();
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Name",
      "Description",
      "Technician",
      "Department",
      "Items",
      "Actions",
    ]);
  });

  it("renders name, description, assigned technician, department and total units", () => {
    summaries.c1 = { skuCount: 40, totalUnits: 1244, totalValue: 5000, lowCount: 0 };
    renderTable();
    expect(screen.getByText("Van 1")).toBeInTheDocument();
    expect(screen.getByText("Ford Transit")).toBeInTheDocument();
    expect(screen.getByText("TYLER BOUCHER")).toBeInTheDocument();
    expect(screen.getByText("Connecticut")).toBeInTheDocument();
    expect(screen.getByText("1,244")).toBeInTheDocument();
  });

  it("left-aligns everything — headers, cells, numbers and the actions", () => {
    renderTable();
    for (const el of document.querySelectorAll("th, td, td *")) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/text-right|justify-end/);
    }
  });

  it("shows Unassigned for a container without a technician, and — without a description", () => {
    renderTable([container({ technicianId: undefined, technicianName: undefined, description: undefined })]);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(document.querySelectorAll("tbody td")[1]).toHaveTextContent("—");
  });

  it("shows a Low stock badge only when something is low", () => {
    summaries.c1 = { skuCount: 4, totalUnits: 500, totalValue: 100, lowCount: 1 };
    const { unmount } = renderTable();
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    unmount();

    renderTable([container({ id: "c2" })]);
    expect(screen.queryByText("Low stock")).not.toBeInTheDocument();
  });

  it("reads stock only for the rows it is given — the page, not the fleet", () => {
    renderTable([container({ id: "c1" }), container({ id: "c7", name: "Van 7" })]);
    expect(new Set(stockAskedFor)).toEqual(new Set(["c1", "c7"]));
  });

  it("opens the van's stock on row click", async () => {
    renderTable();
    await userEvent.click(screen.getByText("Van 1"));
    expect(onStock).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the Edit popup from the pencil, without also opening the stock", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Edit Van 1" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    expect(onStock).not.toHaveBeenCalled();
  });

  it("opens the stock popup from the box button, once", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Stock in Van 1" }));
    expect(onStock).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("has no archive action on the row — Active lives in the Edit popup", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /Archive/ })).not.toBeInTheDocument();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("ContainersTable — a stable first frame", () => {
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
    for (const id of ["name", "description", "technician", "department", "items", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
