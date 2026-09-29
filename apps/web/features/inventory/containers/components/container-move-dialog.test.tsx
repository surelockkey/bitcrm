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
  { type: "container", id: "c1", name: "Taras's van", status: active },
  { type: "container", id: "c150", name: "Pavlo's van", status: active },
];

vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({ data: locations, isLoading: false, isError: false }),
  useMoveStock: () => ({ mutate: mocks.mutate, isPending: false }),
}));

import { ContainerMoveDialog } from "./container-move-dialog";

const item = { productId: "p1", productName: "Deadbolt", onHand: 4 };

describe("ContainerMoveDialog", () => {
  it("hands off to any other van, from every page of the fleet", async () => {
    renderWithClient(<ContainerMoveDialog containerId="c1" item={item} open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Handoff to container" }));
    await userEvent.click(screen.getByRole("combobox"));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Pavlo's van"]);
  });

  it("returns to a warehouse through the move endpoint", async () => {
    renderWithClient(<ContainerMoveDialog containerId="c1" item={item} open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Main" }));
    await userEvent.click(screen.getByRole("button", { name: "Return" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ fromType: "container", fromId: "c1", toType: "warehouse", toId: "w1" }),
      expect.anything(),
    );
  });
});
