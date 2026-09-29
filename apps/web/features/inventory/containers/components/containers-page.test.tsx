import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataScope, InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import type { StockLocation } from "@/features/inventory/stock/lib";
import type { ContainerFilter } from "../api";

const mocks = vi.hoisted(() => ({
  listFilters: [] as ContainerFilter[],
  countFilters: [] as ContainerFilter[],
  rows: [] as Container[],
  locations: [] as StockLocation[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, scopeOf: () => DataScope.ALL }),
}));
vi.mock("../hooks", () => ({
  useContainersList: (filter: ContainerFilter) => {
    mocks.listFilters.push(filter);
    return {
      data: { pages: [{ data: mocks.rows, pagination: {} }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isError: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useContainersCount: (filter: ContainerFilter) => {
    mocks.countFilters.push(filter);
    return { data: { total: 93, atLeast: false } };
  },
  useContainerStockView: () => ({
    summary: { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 },
    isLoading: false,
  }),
}));
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({ data: mocks.locations, isLoading: false, isError: false }),
}));
vi.mock("./container-create-dialog", () => ({ ContainerCreateDialog: () => null }));
vi.mock("./my-container-view", () => ({ MyContainerView: () => null }));

import { ContainersPage } from "./containers-page";

function container(over: Partial<Container>): Container {
  return {
    id: "c1",
    name: "Van 1",
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const active = InventoryStatus.ACTIVE;

beforeEach(() => {
  mocks.listFilters = [];
  mocks.countFilters = [];
  mocks.rows = [container({ id: "c1", name: "Van Alpha" }), container({ id: "c2", name: "Van Zeta" })];
  mocks.locations = [
    { type: "warehouse", id: "w1", name: "Main", status: active },
    { type: "container", id: "c1", name: "Van Alpha", status: active, department: "South" },
    { type: "container", id: "c9", name: "Van 9", status: active, department: "North" },
    { type: "container", id: "c8", name: "Van 8", status: active, department: "North" },
  ];
});

describe("ContainersPage — the server filters, the page shows what it got", () => {
  it("sends the search to the server after a pause, and to the count as well", async () => {
    render(<ContainersPage />);
    await userEvent.type(screen.getByPlaceholderText(/Search/), "alpha");
    await waitFor(() => expect(mocks.listFilters.at(-1)).toMatchObject({ search: "alpha" }));
    expect(mocks.countFilters.at(-1)).toEqual(mocks.listFilters.at(-1));
    // Not one request per keystroke.
    expect(mocks.listFilters.some((f) => f.search === "alp")).toBe(false);
  });

  it("renders exactly the rows the server returned — no filtering in the browser", async () => {
    render(<ContainersPage />);
    await userEvent.type(screen.getByPlaceholderText(/Search/), "alpha");
    await waitFor(() => expect(mocks.listFilters.at(-1)).toMatchObject({ search: "alpha" }));
    expect(screen.getByText("Van Alpha")).toBeInTheDocument();
    expect(screen.getByText("Van Zeta")).toBeInTheDocument();
  });

  it("offers departments from every container, not just this page", async () => {
    render(<ContainersPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["All departments", "North", "South"]);
  });

  it("sends the department to the server", async () => {
    render(<ContainersPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
    await userEvent.click(await screen.findByRole("option", { name: "North" }));
    expect(mocks.listFilters.at(-1)).toMatchObject({ department: "North" });
    expect(mocks.countFilters.at(-1)).toMatchObject({ department: "North" });
  });

  it("sends the status to the server", async () => {
    render(<ContainersPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Archived" }));
    expect(mocks.listFilters.at(-1)).toMatchObject({ status: InventoryStatus.ARCHIVED });
  });

  it("has no per-page 'N containers' label — the pager says how many", () => {
    render(<ContainersPage />);
    expect(screen.queryByText(/^\d+ containers?$/)).toBeNull();
    expect(screen.getByText(/of 93/)).toBeInTheDocument();
  });
});
