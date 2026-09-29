import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { StockLocation } from "@/features/inventory/stock/lib";

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
const active = InventoryStatus.ACTIVE;
const locations: StockLocation[] = [
  { type: "warehouse", id: "w1", name: "Main", status: active },
  { type: "container", id: "c1", name: "Taras's van", status: active, department: "North" },
  { type: "container", id: "c150", name: "Pavlo's van", status: active },
];

vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({ data: locations, isLoading: false, isError: false }),
  useMoveStock: () => ({ mutate: mocks.mutate, isPending: false }),
}));

import { TransferStockDialog } from "./transfer-stock-dialog";

describe("TransferStockDialog", () => {
  it("offers every van, and moves through the move endpoint", async () => {
    renderWithClient(
      <TransferStockDialog
        warehouseId="w1"
        item={{ productId: "p1", productName: "Deadbolt", onHand: 9 }}
        open
        onOpenChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Taras's van · North", "Pavlo's van"]);

    await userEvent.click(options[1]);
    await userEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        fromType: "warehouse",
        fromId: "w1",
        toType: "container",
        toId: "c150",
        items: [{ productId: "p1", productName: "Deadbolt", quantity: 1 }],
      },
      expect.anything(),
    );
  });
});
