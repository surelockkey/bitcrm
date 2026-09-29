import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import type { StockLocation } from "@/features/inventory/stock/lib";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), locations: [] as StockLocation[] }));

vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({ data: mocks.locations, isLoading: false, isError: false }),
  useMoveStock: () => ({ mutate: mocks.mutate, isPending: false }),
}));

import { NewTransferDialog } from "./new-transfer-dialog";

const active = InventoryStatus.ACTIVE;

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.locations = [
    { type: "warehouse", id: "w1", name: "Main", status: active },
    { type: "warehouse", id: "w2", name: "Overflow", status: active },
    { type: "container", id: "c1", name: "Taras's van", status: active, department: "North" },
    { type: "container", id: "c150", name: "Pavlo's van", status: active },
  ];
});

async function pick(combobox: number, option: string | RegExp) {
  await userEvent.click(screen.getAllByRole("combobox")[combobox]);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

describe("NewTransferDialog", () => {
  it("offers every location as a source", async () => {
    renderWithClient(<NewTransferDialog open onOpenChange={() => {}} />);
    await userEvent.click(screen.getAllByRole("combobox")[0]);
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Main", "Overflow", "Taras's van · North", "Pavlo's van"]);
  });

  it("allows warehouse → warehouse, never a location to itself", async () => {
    server.use(
      http.get("*/inventory/warehouses/w1/stock", () => HttpResponse.json({ success: true, data: [] })),
    );
    renderWithClient(<NewTransferDialog open onOpenChange={() => {}} />);
    await pick(0, "Main");
    await userEvent.click(screen.getAllByRole("combobox")[1]);
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Overflow", "Taras's van · North", "Pavlo's van"]);
  });

  it("moves the chosen stock through the move endpoint", async () => {
    server.use(
      http.get("*/inventory/containers/c1/stock", () =>
        HttpResponse.json({
          success: true,
          data: [{ productId: "p1", productName: "Deadbolt", quantity: 5, updatedAt: "" }],
        }),
      ),
    );
    renderWithClient(<NewTransferDialog open onOpenChange={() => {}} />);
    await pick(0, /Taras/);
    await pick(1, "Pavlo's van");
    await userEvent.type(screen.getByPlaceholderText(/Add a product/), "Dead");
    await userEvent.click(await screen.findByRole("button", { name: /Deadbolt/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create transfer" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        fromType: "container",
        fromId: "c1",
        toType: "container",
        toId: "c150",
        items: [{ productId: "p1", productName: "Deadbolt", quantity: 1 }],
        notes: undefined,
      },
      expect.anything(),
    );
  });
});
