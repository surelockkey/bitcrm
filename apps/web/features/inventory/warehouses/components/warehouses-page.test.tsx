import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Warehouse } from "@bitcrm/types";
import type { WarehouseFilter } from "../api";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  listFilters: [] as WarehouseFilter[],
  countFilters: [] as WarehouseFilter[],
  rows: [] as Warehouse[],
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  /** What the list hook answers beyond its rows: first load, or a held-over page. */
  list: { isLoading: false, isPlaceholderData: false, noData: false },
  perms: { loading: false, can: true },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/inventory/warehouses",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => !mocks.perms.loading && !mocks.perms.can,
  usePermissions: () => ({
    can: () => !mocks.perms.loading && mocks.perms.can,
    isLoading: mocks.perms.loading,
  }),
}));
vi.mock("../hooks", () => ({
  useWarehousesList: (filter: WarehouseFilter) => {
    mocks.listFilters.push(filter);
    return {
      data: mocks.list.noData ? undefined : { pages: [{ data: mocks.rows, pagination: {} }] },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: mocks.list.isLoading,
      isPlaceholderData: mocks.list.isPlaceholderData,
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
// The popups have suites of their own; here only which one the URL opens matters.
vi.mock("./warehouse-edit-dialog", () => ({
  WarehouseEditDialog: (props: { warehouseId: string; open: boolean; onOpenChange: (o: boolean) => void }) =>
    props.open ? (
      <div data-testid="edit-popup" data-id={props.warehouseId}>
        <button onClick={() => props.onOpenChange(false)}>close edit</button>
      </div>
    ) : null,
}));
vi.mock("@/features/inventory/stock/components/location-stock-dialog", () => ({
  LocationStockDialog: (props: {
    type: string;
    locationId: string;
    open: boolean;
    onOpenChange: (o: boolean) => void;
  }) =>
    props.open ? (
      <div data-testid="stock-popup" data-type={props.type} data-id={props.locationId}>
        <button onClick={() => props.onOpenChange(false)}>close stock</button>
      </div>
    ) : null,
}));

import { WarehousesPage } from "./warehouses-page";

function warehouse(over: Partial<Warehouse>): Warehouse {
  return { id: "w1", name: "Main", status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "", ...over };
}

beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.listFilters = [];
  mocks.countFilters = [];
  mocks.rows = [warehouse({ id: "w1", name: "Dallas" }), warehouse({ id: "w2", name: "Austin" })];
  mocks.list = { isLoading: false, isPlaceholderData: false, noData: false };
  mocks.perms = { loading: false, can: true };
});

describe("WarehousesPage — the server filters, the page shows what it got", () => {
  it("starts on active warehouses, asked of the server", () => {
    renderWithClient(<WarehousesPage />);
    expect(mocks.listFilters.at(-1)).toEqual({ status: InventoryStatus.ACTIVE });
    expect(mocks.countFilters.at(-1)).toEqual({ status: InventoryStatus.ACTIVE });
  });

  it("sends the search after a pause and shows exactly the rows that came back", async () => {
    renderWithClient(<WarehousesPage />);
    await userEvent.type(screen.getByPlaceholderText("Search warehouses"), "dal");
    await waitFor(() => expect(mocks.listFilters.at(-1)).toMatchObject({ search: "dal" }));
    expect(mocks.countFilters.at(-1)).toEqual(mocks.listFilters.at(-1));
    expect(screen.getByText("Dallas")).toBeInTheDocument();
    expect(screen.getByText("Austin")).toBeInTheDocument();
  });

  it("sends 'All statuses' as no status filter", async () => {
    renderWithClient(<WarehousesPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "All statuses" }));
    expect(mocks.listFilters.at(-1)).toEqual({});
  });

  it("pages with the shared pager instead of a per-page count", () => {
    renderWithClient(<WarehousesPage />);
    expect(screen.queryByText(/^\d+ warehouses?$/)).toBeNull();
    expect(screen.getByText(/of 42/)).toBeInTheDocument();
  });
});

const noScroll = { scroll: false };

describe("WarehousesPage — popups are driven by the URL", () => {
  it("opens the warehouse's stock from ?stock=<id>", () => {
    mocks.params = new URLSearchParams("stock=w9");
    renderWithClient(<WarehousesPage />);
    const popup = screen.getByTestId("stock-popup");
    expect(popup).toHaveAttribute("data-type", "warehouse");
    expect(popup).toHaveAttribute("data-id", "w9");
  });

  it("opens the Edit popup from ?edit=<id>", () => {
    mocks.params = new URLSearchParams("edit=w9");
    renderWithClient(<WarehousesPage />);
    expect(screen.getByTestId("edit-popup")).toHaveAttribute("data-id", "w9");
    expect(screen.queryByTestId("stock-popup")).toBeNull();
  });

  it("puts ?stock=<id> in the URL from a row click, ?edit=<id> from the pencil", async () => {
    renderWithClient(<WarehousesPage />);
    await userEvent.click(screen.getByText("Dallas"));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/warehouses?stock=w1", noScroll);
    await userEvent.click(screen.getByRole("button", { name: "Edit Austin" }));
    expect(mocks.push).toHaveBeenCalledWith("/inventory/warehouses?edit=w2", noScroll);
  });

  it("closing a popup replaces the URL, so Back doesn't reopen it", async () => {
    mocks.params = new URLSearchParams("edit=w9");
    renderWithClient(<WarehousesPage />);
    await userEvent.click(screen.getByText("close edit"));
    expect(mocks.replace).toHaveBeenCalledWith("/inventory/warehouses", noScroll);
  });
});

/**
 * "Nothing jumps": the first frame is the table itself, a new filter keeps
 * the rows it has, and permissions arriving late neither flash "No access"
 * nor push buttons into the toolbar.
 */
describe("WarehousesPage — a stable first frame", () => {
  const headers = () => [...document.querySelectorAll("thead th")].map((th) => th.textContent);

  it("draws the real table while the first page loads, with the pager's space held", () => {
    mocks.list = { isLoading: true, isPlaceholderData: false, noData: true };
    renderWithClient(<WarehousesPage />);

    expect(headers()).toEqual(["Name", "Description", "Items", "SKUs", "Actions"]);
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.getByTestId("list-pagination")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the rows on screen, dimmed, while a new search loads", () => {
    mocks.list = { isLoading: false, isPlaceholderData: true, noData: false };
    renderWithClient(<WarehousesPage />);

    expect(screen.getByText("Dallas")).toBeInTheDocument();
    expect(screen.queryByTestId("skeleton-row")).toBeNull();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("never flashes No access while permissions are still loading", () => {
    mocks.perms = { loading: true, can: false };
    renderWithClient(<WarehousesPage />);

    expect(screen.queryByText("No access")).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("says No access once it is known", () => {
    mocks.perms = { loading: false, can: false };
    renderWithClient(<WarehousesPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("holds New warehouse's place, disabled, until permissions are known", () => {
    mocks.perms = { loading: true, can: false };
    renderWithClient(<WarehousesPage />);
    expect(screen.getByRole("button", { name: /New warehouse/ })).toBeDisabled();
  });
});
