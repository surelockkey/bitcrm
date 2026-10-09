import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { StockLocation, StockTarget } from "../lib";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;

const mocks = vi.hoisted(() => ({
  receive: vi.fn(),
  move: vi.fn(),
  ret: vi.fn(),
  pending: false,
  succeed: true,
  locationsEnabled: [] as boolean[],
}));

const active = InventoryStatus.ACTIVE;
const locations: StockLocation[] = [
  { type: "warehouse", id: "w1", name: "Main", status: active },
  { type: "warehouse", id: "w2", name: "Old yard", status: InventoryStatus.ARCHIVED },
  { type: "container", id: "c1", name: "Taras's van", status: active, technicianName: "Taras" },
  { type: "container", id: "c2", name: "Pavlo's van", status: active, technicianName: "Pavlo Kh", department: "North" },
];

// A mutation that answers at once — succeeding unless a spec says otherwise.
const mutation = (fn: (vars: unknown) => void) => ({
  isPending: mocks.pending,
  mutate: ((vars, opts) => {
    fn(vars);
    if (mocks.succeed) opts?.onSuccess?.();
  }) as Mutate,
});

vi.mock("../hooks", () => ({
  useReceiveStock: () => mutation(mocks.receive),
  useMoveStock: () => mutation(mocks.move),
  useReturnStock: () => mutation(mocks.ret),
  useAllLocations: (enabled = true) => {
    mocks.locationsEnabled.push(enabled);
    return { data: locations, isLoading: false, isError: false };
  },
}));

import { AddStockDialog, MoveStockDialog, ReturnStockDialog } from "./stock-action-dialogs";

const target: StockTarget = {
  product: { id: "p1", name: "Deadbolt" },
  location: { type: "container", id: "c1", name: "Taras's van" },
  available: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = false;
  mocks.succeed = true;
  mocks.locationsEnabled = [];
});

const quantity = () => screen.getByLabelText("Quantity");
const notes = () => screen.getByLabelText(/Notes/);

async function setQuantity(value: string) {
  await userEvent.clear(quantity());
  if (value) await userEvent.type(quantity(), value);
}

describe("AddStockDialog", () => {
  function open() {
    const onOpenChange = vi.fn();
    renderWithClient(<AddStockDialog target={target} open onOpenChange={onOpenChange} />);
    return { onOpenChange };
  }

  it("is Workiz's \"Add items\", the item and the location in its description", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Add items" })).toHaveAccessibleDescription("Deadbolt — Taras's van");
  });

  it("receives the quantity into this location, notes trimmed", async () => {
    const { onOpenChange } = open();
    await setQuantity("12");
    await userEvent.type(notes(), "  Supplier order 4411 ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.receive).toHaveBeenCalledTimes(1);
    expect(mocks.receive.mock.calls[0][0]).toStrictEqual({
      toType: "container",
      toId: "c1",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 12 }],
      notes: "Supplier order 4411",
    });
    // Done: the small dialog closes, the popup under it stays.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no ceiling — stock comes from the supplier — and sends no empty notes", async () => {
    open();
    await setQuantity("500");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.receive.mock.calls[0][0]).toStrictEqual({
      toType: "container",
      toId: "c1",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 500 }],
    });
  });

  it("refuses zero, fractions and an empty field", async () => {
    open();
    const submit = screen.getByRole("button", { name: "Save" });

    await setQuantity("0");
    expect(screen.getByText("Enter 1 or more")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await setQuantity("2.5");
    expect(screen.getByText("Whole units only")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await setQuantity("");
    expect(submit).toBeDisabled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("stays open when the server refuses", async () => {
    mocks.succeed = false;
    const { onOpenChange } = open();
    await userEvent.type(quantity(), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.receive).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("can't be sent twice while the first is on its way", () => {
    mocks.pending = true;
    open();
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });
});

describe("MoveStockDialog", () => {
  function open() {
    const onOpenChange = vi.fn();
    renderWithClient(<MoveStockDialog target={target} open onOpenChange={onOpenChange} />);
    return { onOpenChange };
  }
  const picker = () => screen.getByRole("combobox", { name: "To location" });

  async function pick(name: string) {
    await userEvent.click(picker());
    await userEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
  }

  it("is Workiz's \"Move items to container\", the item and the location in its description", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Move items to container" })).toHaveAccessibleDescription("Deadbolt — Taras's van");
  });

  // Every row of a stock popup mounts its Move dialog closed; each one paging
  // through every warehouse and van would be a request storm.
  it("loads the locations only while open", () => {
    const { rerender } = renderWithClient(
      <MoveStockDialog target={target} open={false} onOpenChange={() => {}} />,
    );
    expect(mocks.locationsEnabled.length).toBeGreaterThan(0);
    expect(new Set(mocks.locationsEnabled)).toEqual(new Set([false]));

    mocks.locationsEnabled = [];
    rerender(<MoveStockDialog target={target} open onOpenChange={() => {}} />);
    expect(mocks.locationsEnabled.length).toBeGreaterThan(0);
    expect(new Set(mocks.locationsEnabled)).toEqual(new Set([true]));
  });

  it("offers every other active location, grouped, with the van's technician and department", async () => {
    open();
    await userEvent.click(picker());

    const warehouses = screen.getByRole("group", { name: "Warehouses" });
    const containers = screen.getByRole("group", { name: "Containers" });
    expect(within(warehouses).getAllByRole("option").map((o) => o.textContent)).toEqual(["Main"]);
    // The source is not a target; archived locations aren't either.
    expect(within(containers).getAllByRole("option")).toHaveLength(1);
    expect(within(containers).getByRole("option")).toHaveTextContent("Pavlo's van");
    expect(within(containers).getByRole("option")).toHaveTextContent("Pavlo Kh · North");
    expect(screen.queryByRole("option", { name: /Taras's van/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Old yard/ })).toBeNull();
  });

  it("searches the targets", async () => {
    open();
    await userEvent.click(picker());
    await userEvent.type(screen.getByPlaceholderText("Search locations"), "north");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Pavlo's van"),
    ]);
  });

  it("moves up to what this location holds to the picked one", async () => {
    const { onOpenChange } = open();
    await pick("Pavlo's van");
    expect(picker()).toHaveTextContent("Pavlo's van");
    await setQuantity("4");
    await userEvent.type(notes(), "Swap for the weekend");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.move.mock.calls[0][0]).toStrictEqual({
      fromType: "container",
      fromId: "c1",
      toType: "container",
      toId: "c2",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 4 }],
      notes: "Swap for the weekend",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("moves into a warehouse as a warehouse", async () => {
    open();
    await pick("Main");
    await userEvent.type(quantity(), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.move.mock.calls[0][0]).toMatchObject({ toType: "warehouse", toId: "w1", items: [{ quantity: 1 }] });
  });

  it("closes the open list on Escape and keeps the dialog", async () => {
    const { onOpenChange } = open();
    await userEvent.click(picker());
    expect(screen.getByPlaceholderText("Search locations")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText("Search locations")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("won't move more than is here, nor without a target", async () => {
    open();
    const submit = screen.getByRole("button", { name: "Save" });
    expect(submit).toBeDisabled(); // no target yet

    await pick("Main");
    await setQuantity("5");
    expect(screen.getByText("Only 4 available")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await setQuantity("0");
    expect(submit).toBeDisabled();
    expect(mocks.move).not.toHaveBeenCalled();
  });
});

describe("ReturnStockDialog", () => {
  function open() {
    const onOpenChange = vi.fn();
    renderWithClient(<ReturnStockDialog target={target} open onOpenChange={onOpenChange} />);
    return { onOpenChange };
  }

  async function reason(label: string) {
    await userEvent.click(screen.getByRole("combobox", { name: "Reason" }));
    await userEvent.click(screen.getByRole("option", { name: label }));
  }

  it("is Workiz's \"Item return\", the item and the location in its description", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Item return" })).toHaveAccessibleDescription("Deadbolt — Taras's van");
  });

  it("offers Recall, Damaged, Lost and Other", async () => {
    open();
    await userEvent.click(screen.getByRole("combobox", { name: "Reason" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Recall",
      "Damaged",
      "Lost",
      "Other",
    ]);
  });

  it("takes the stock out with its reason and notes", async () => {
    const { onOpenChange } = open();
    await setQuantity("3");
    await reason("Damaged");
    await userEvent.type(notes(), "Cracked housing");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.ret.mock.calls[0][0]).toStrictEqual({
      fromType: "container",
      fromId: "c1",
      items: [{ productId: "p1", productName: "Deadbolt", quantity: 3 }],
      reason: "damaged",
      notes: "Cracked housing",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("needs a reason and no more than is here", async () => {
    open();
    const submit = screen.getByRole("button", { name: "Save" });
    expect(submit).toBeDisabled(); // no number, no reason yet

    await reason("Lost");
    expect(submit).toBeDisabled(); // Workiz's empty Quantity box
    await setQuantity("1");
    expect(submit).toBeEnabled();

    await setQuantity("9");
    expect(screen.getByText("Only 4 available")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    expect(mocks.ret).not.toHaveBeenCalled();
  });
});
