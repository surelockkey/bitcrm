import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import type { StockSummary } from "@/features/inventory/warehouses/lib";
import { ContainersTable } from "./containers-table";

const push = vi.fn();
const summaries: Record<string, StockSummary> = {};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../hooks", () => ({
  useContainerStockView: (id: string) => ({
    summary:
      summaries[id] ?? { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 },
    isLoading: false,
  }),
}));

function container(over: Partial<Container>): Container {
  return {
    id: "c1",
    name: "Van 1",
    technicianId: "t1",
    technicianName: "TYLER BOUCHER",
    department: "Connecticut",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

beforeEach(() => {
  push.mockClear();
  for (const k of Object.keys(summaries)) delete summaries[k];
});

describe("ContainersTable", () => {
  it("renders name, assigned technician, department and total units", () => {
    summaries.c1 = { skuCount: 40, totalUnits: 1244, totalValue: 5000, lowCount: 0 };
    render(<ContainersTable containers={[container({})]} />);
    expect(screen.getByText("Van 1")).toBeInTheDocument();
    expect(screen.getByText("TYLER BOUCHER")).toBeInTheDocument();
    expect(screen.getByText("Connecticut")).toBeInTheDocument();
    expect(screen.getByText("1,244")).toBeInTheDocument();
  });

  it("shows Unassigned for a container without a technician", () => {
    render(
      <ContainersTable
        containers={[
          container({ technicianId: undefined, technicianName: undefined }),
        ]}
      />,
    );
    expect(screen.getByText("Van 1")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows a Low stock badge only when something is low", () => {
    summaries.c1 = { skuCount: 4, totalUnits: 500, totalValue: 100, lowCount: 1 };
    const { rerender } = render(<ContainersTable containers={[container({})]} />);
    expect(screen.getByText("Low stock")).toBeInTheDocument();

    summaries.c1 = { skuCount: 4, totalUnits: 500, totalValue: 100, lowCount: 0 };
    rerender(<ContainersTable containers={[container({ id: "c2" })]} />);
    expect(screen.queryByText("Low stock")).not.toBeInTheDocument();
  });

  it("navigates to the container on row click", async () => {
    render(<ContainersTable containers={[container({})]} />);
    await userEvent.click(screen.getByText("Van 1"));
    expect(push).toHaveBeenCalledWith("/inventory/containers/c1");
  });

  it("has a view-stock action but no archive action", async () => {
    render(<ContainersTable containers={[container({})]} />);
    await userEvent.click(screen.getByRole("button", { name: "View stock" }));
    expect(push).toHaveBeenCalledWith("/inventory/containers/c1");
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("ContainersTable — a stable first frame", () => {
  const table = () => render(<ContainersTable containers={[container({})]} />).container;

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
    for (const id of ["name", "technician", "department", "items", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
