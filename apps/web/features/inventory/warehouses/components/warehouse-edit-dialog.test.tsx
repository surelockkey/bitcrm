import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { StockItem, Warehouse } from "@bitcrm/types";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;
type Query<T> = { isLoading: boolean; isError: boolean; data: T | undefined };

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  query: undefined as unknown as Query<Warehouse>,
  stock: undefined as unknown as Query<StockItem[]>,
  stockAsked: [] as boolean[],
  queried: [] as string[],
  update: vi.fn(),
  archive: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));

const answering = (fn: (vars: unknown) => void) => ({
  isPending: false,
  mutate: ((vars, opts) => {
    fn(vars);
    opts?.onSuccess?.();
  }) as Mutate,
});
vi.mock("../hooks", () => ({
  useWarehouse: (id: string) => {
    mocks.queried.push(id);
    return mocks.query;
  },
  useWarehouseStock: (_id: string, enabled: boolean) => {
    mocks.stockAsked.push(enabled);
    return mocks.stock;
  },
  useUpdateWarehouse: () => answering(mocks.update),
  useArchiveWarehouse: () => answering(mocks.archive),
}));

import { WarehouseEditDialog } from "./warehouse-edit-dialog";

const SHOP: Warehouse = {
  id: "w1",
  name: "WAREHOUSE TX",
  address: "800 W Campbell Rd",
  description: "RICHARDSON SHOP",
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const held = (quantity: number): StockItem => ({ productId: "p", productName: "P", quantity, updatedAt: "" });

beforeEach(() => {
  mocks.denied = new Set();
  mocks.query = { isLoading: false, isError: false, data: SHOP };
  mocks.stock = { isLoading: false, isError: false, data: [held(700), held(58), held(0)] };
  mocks.queried = [];
  mocks.stockAsked = [];
  mocks.update.mockReset();
  mocks.archive.mockReset();
});

function open() {
  const onOpenChange = vi.fn();
  render(<WarehouseEditDialog warehouseId="w1" open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));

describe("WarehouseEditDialog — the warehouse's settings in a popup", () => {
  it("is a dialog titled Edit warehouse, reading the one it was opened for", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Edit warehouse" })).toBeInTheDocument();
    expect(mocks.queried).toContain("w1");
  });

  it("shows the current name, address and description", () => {
    open();
    expect(screen.getByLabelText("Name")).toHaveValue("WAREHOUSE TX");
    expect(screen.getByLabelText("Address")).toHaveValue("800 W Campbell Rd");
    expect(screen.getByLabelText("Description")).toHaveValue("RICHARDSON SHOP");
  });

  it("saves the edited fields and closes", async () => {
    const { onOpenChange } = open();
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Dallas");
    await save();
    expect(mocks.update).toHaveBeenCalledWith({
      id: "w1",
      body: { name: "Dallas", address: "800 W Campbell Rd", description: "RICHARDSON SHOP" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("won't save a warehouse without a name", async () => {
    open();
    await userEvent.clear(screen.getByLabelText("Name"));
    await save();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("just closes when nothing changed", async () => {
    const { onOpenChange } = open();
    await save();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("WarehouseEditDialog — archiving", () => {
  it("archives after a warning about the stock still on the shelf, then closes", async () => {
    const { onOpenChange } = open();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText(/still holds/)).toHaveTextContent("758 units");
    expect(mocks.archive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Archive warehouse" }));
    expect(mocks.archive).toHaveBeenCalledWith("w1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no Archive on an archived warehouse, or without warehouses.delete", () => {
    mocks.query = { isLoading: false, isError: false, data: { ...SHOP, status: InventoryStatus.ARCHIVED } };
    const { unmount } = render(<WarehouseEditDialog warehouseId="w1" open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    unmount();

    mocks.query = { isLoading: false, isError: false, data: SHOP };
    mocks.denied.add("warehouses.delete");
    open();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
});

describe("WarehouseEditDialog — without warehouses.edit", () => {
  it("is view-only: fields locked, Close instead of Save", () => {
    mocks.denied.add("warehouses.edit");
    open();
    expect(screen.getByRole("dialog", { name: "Warehouse" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Address")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("WarehouseEditDialog — loading and missing", () => {
  it("shows a skeleton while it loads", () => {
    mocks.query = { isLoading: true, isError: false, data: undefined };
    open();
    expect(screen.getByTestId("warehouse-edit-loading")).toBeInTheDocument();
  });

  // Opened and then filled in, the popup grew by its footer.
  it("has its footer in place while it loads", () => {
    mocks.query = { isLoading: true, isError: false, data: undefined };
    open();
    expect(screen.getByTestId("dialog-footer-placeholder")).toBeInTheDocument();
  });

  it("says the warehouse is gone when it can't be read", () => {
    mocks.query = { isLoading: false, isError: true, data: undefined };
    open();
    expect(screen.getByRole("dialog", { name: "Warehouse not found" })).toBeInTheDocument();
  });
});

/**
 * The archive warning names the units still on the shelf. The row carries
 * them now (`totalUnits`): no stock request for a number the list already has.
 */
describe("WarehouseEditDialog — the units on the shelf", () => {
  it("takes them from the warehouse's own total, asking for no stock", async () => {
    mocks.query = { isLoading: false, isError: false, data: { ...SHOP, totalUnits: 1234 } as Warehouse };
    open();
    expect(mocks.stockAsked.every((asked) => !asked)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText(/still holds/)).toHaveTextContent("1,234 units");
  });

  it("reads the stock only for a warehouse the backfill has not reached", () => {
    open();
    expect(mocks.stockAsked.at(-1)).toBe(true);
  });
});
