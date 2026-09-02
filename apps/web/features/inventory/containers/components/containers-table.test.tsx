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
