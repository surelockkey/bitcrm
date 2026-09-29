import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import type { StockSummary } from "../lib";
import { WarehousesTable } from "./warehouses-table";

const push = vi.fn();
const archiveMutate = vi.fn();
const summaries: Record<string, StockSummary> = {};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useWarehouseStockView: (id: string) => ({
    summary:
      summaries[id] ?? { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 },
    isLoading: false,
  }),
  useArchiveWarehouse: () => ({ mutate: archiveMutate, isPending: false }),
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

beforeEach(() => {
  push.mockClear();
  archiveMutate.mockClear();
  for (const k of Object.keys(summaries)) delete summaries[k];
});

describe("WarehousesTable", () => {
  it("renders name, description and total units", () => {
    summaries.w1 = { skuCount: 12, totalUnits: 36498, totalValue: 900, lowCount: 0 };
    render(<WarehousesTable warehouses={[warehouse({})]} />);
    expect(screen.getByText("WAREHOUSE TX")).toBeInTheDocument();
    expect(screen.getByText("RICHARDSON SHOP")).toBeInTheDocument();
    expect(screen.getByText("36,498")).toBeInTheDocument();
  });

  it("falls back to the address when there is no description", () => {
    render(
      <WarehousesTable warehouses={[warehouse({ description: undefined })]} />,
    );
    expect(screen.getByText("800 W Campbell Rd")).toBeInTheDocument();
  });

  it("shows a Low stock badge only when something is low", () => {
    summaries.w1 = { skuCount: 3, totalUnits: 758, totalValue: 100, lowCount: 2 };
    const { rerender } = render(<WarehousesTable warehouses={[warehouse({})]} />);
    expect(screen.getByText("Low stock")).toBeInTheDocument();

    summaries.w1 = { skuCount: 3, totalUnits: 758, totalValue: 100, lowCount: 0 };
    rerender(<WarehousesTable warehouses={[warehouse({ id: "w2" })]} />);
    expect(screen.queryByText("Low stock")).not.toBeInTheDocument();
  });

  it("navigates to the detail page on row click", async () => {
    render(<WarehousesTable warehouses={[warehouse({})]} />);
    await userEvent.click(screen.getByText("WAREHOUSE TX"));
    expect(push).toHaveBeenCalledWith("/inventory/warehouses/w1");
  });

  it("edit action deep-links to the settings tab", async () => {
    render(<WarehousesTable warehouses={[warehouse({})]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(push).toHaveBeenCalledWith("/inventory/warehouses/w1?tab=settings");
  });

  it("archive action asks for confirmation, then archives", async () => {
    render(<WarehousesTable warehouses={[warehouse({})]} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archiveMutate).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Archive warehouse" }),
    );
    expect(archiveMutate).toHaveBeenCalledWith("w1");
  });

  it("hides the archive action on archived warehouses", () => {
    render(
      <WarehousesTable
        warehouses={[warehouse({ status: InventoryStatus.ARCHIVED })]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("WarehousesTable — a stable first frame", () => {
  const table = () => render(<WarehousesTable warehouses={[warehouse({})]} />).container;

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
