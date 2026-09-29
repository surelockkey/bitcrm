import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import type { WarehouseFilter } from "../api";

const mocks = vi.hoisted(() => ({
  listFilters: [] as WarehouseFilter[],
  countFilters: [] as WarehouseFilter[],
  rows: [] as Warehouse[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useWarehousesList: (filter: WarehouseFilter) => {
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
  useWarehousesCount: (filter: WarehouseFilter) => {
    mocks.countFilters.push(filter);
    return { data: { total: 42, atLeast: false } };
  },
  useArchiveWarehouse: () => ({ mutate: vi.fn(), isPending: false }),
  useWarehouseStockView: () => ({
    summary: { skuCount: 0, totalUnits: 0, totalValue: 0, lowCount: 0 },
    isLoading: false,
  }),
}));
vi.mock("./warehouse-create-dialog", () => ({ WarehouseCreateDialog: () => null }));

import { WarehousesPage } from "./warehouses-page";

function warehouse(over: Partial<Warehouse>): Warehouse {
  return { id: "w1", name: "Main", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "", ...over };
}

beforeEach(() => {
  mocks.listFilters = [];
  mocks.countFilters = [];
  mocks.rows = [warehouse({ id: "w1", name: "Dallas" }), warehouse({ id: "w2", name: "Austin" })];
});

describe("WarehousesPage — the server filters, the page shows what it got", () => {
  it("starts on active warehouses, asked of the server", () => {
    render(<WarehousesPage />);
    expect(mocks.listFilters.at(-1)).toEqual({ status: InventoryStatus.ACTIVE });
    expect(mocks.countFilters.at(-1)).toEqual({ status: InventoryStatus.ACTIVE });
  });

  it("sends the search after a pause and shows exactly the rows that came back", async () => {
    render(<WarehousesPage />);
    await userEvent.type(screen.getByPlaceholderText("Search warehouses"), "dal");
    await waitFor(() => expect(mocks.listFilters.at(-1)).toMatchObject({ search: "dal" }));
    expect(mocks.countFilters.at(-1)).toEqual(mocks.listFilters.at(-1));
    expect(screen.getByText("Dallas")).toBeInTheDocument();
    expect(screen.getByText("Austin")).toBeInTheDocument();
  });

  it("sends 'All statuses' as no status filter", async () => {
    render(<WarehousesPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "All statuses" }));
    expect(mocks.listFilters.at(-1)).toEqual({});
  });

  it("pages with the shared pager instead of a per-page count", () => {
    render(<WarehousesPage />);
    expect(screen.queryByText(/^\d+ warehouses?$/)).toBeNull();
    expect(screen.getByText(/of 42/)).toBeInTheDocument();
  });
});
